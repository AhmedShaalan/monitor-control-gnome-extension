// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2025 Ahmed Shaalan

import Gio    from 'gi://Gio'
import GLib    from 'gi://GLib'
import Gvc     from 'gi://Gvc'
import Meta    from 'gi://Meta'
import Shell   from 'gi://Shell'

import * as Main           from 'resource:///org/gnome/shell/ui/main.js'

import {Extension}         from 'resource:///org/gnome/shell/extensions/extension.js'
import {InjectionManager}  from 'resource:///org/gnome/shell/extensions/extension.js'

import {MVBrightnessItem}  from './js/ui/brightnessItem.js'
import {MVVolumeItem}      from './js/ui/volumeItem.js'
import {LOG, castInt, isEmpty, avgVM, sleep, clearAllTimeouts} from './js/utils.js'
import {Lock}              from './js/lock.js'
import {SetValueIntent}    from './js/setValueIntent.js'
import {DdcutilWrapper}    from './js/ddcutilWrapper.js'
import {DdcutilHelper}     from './js/ddcutilHelper.js'

import './js/promisify.js'


let _DdcutilWrapper = null
let _DdcutilHelper = null

// vcp codes for the specific monitor features
const VCP_BRIGHTNESS = '10'
const VCP_VOLUMEOUT = '62'

// delay after monitors-changed detected
//
// if we try to run ddcutil immediately when monitors-changed happens,
// it can break the display configuration because of I2C bus
// congestion
const MONITORS_CHANGED_SETTLE_MS = 500
// DDC is really bad, please be patient
const RETRY_DELAY_MS = 1000

// default step if settings are unavailable
const KEYBOARD_STEP_DEFAULT = 2


// The extension adds a Volume and Brightness slider to the
// QuickSettings menu. These sliders control the externally connected
// monitor(s)
export default class MonitorBrightnessVolumeExtension extends Extension {

  // Find connected monitors and current brightness/volume levels
  async _readInitialValues () {
    // we don't want to accidentally be in this function twice at the
    // same time
    await this._readInitialValuesLock.acquire()
    LOG("Searching for DDC/I2C monitors")
    let detectedMonitors = {}
    const detected = { _volume: {}, _brightness: {} }

    // - query the given buses for a specific vcpCode (volume, brightness)
    // - set the slider based on the returned value
    // - store the detected I2C buses and merge with buses detected previously
    //
    // vcpCode: code to query in ddcutil
    // name: name of the property that contains the slider item
    // enabledCb: callback to configure visibility and shortcut keys
    //            if a value was found
    // bus: list of buses to query
    const configureValue = async ({ vcpCode, name, enabledCb, bus }) => {
      const value = await _DdcutilHelper?._getVcpValid(vcpCode, bus, maxRetry)
      detected[name] = {...detected[name], ...value}

      if (!isEmpty(value)) {
        const val = avgVM(Object.values(detected[name]))

        // skip changing the slider if the user already has tried to
        // set it to a new value
        if (!this[name]._userSet)
          this[name]._changeSlider(val)

        this[name + 'Bus'] = Object.keys(detected[name])
        this[name + 'BusMaxRng'] = Object.fromEntries(
          Object.keys(detected[name]).map(k => [k, detected[name][k][1]]))
        this[name + 'Available'] = true

        enabledCb(name)
      }
    }

    // disable and hide a slider if no values were found
    //
    // name: name of the property that contains the slider item
    // disabledCb: callback to configure visibility and shortcut keys
    //             if no value was found
    const configureNoValue = ({ name, disabledCb }) => {
      if (isEmpty(detected[name])) {
        this[name + 'Bus'] = []
        this[name + 'BusMaxRng'] = []
        this[name + 'Available'] = false
        disabledCb(name)
      }
    }

    // before starting the detection, we re-set the "set by user" state of the sliders
    this._volume._userSet = false
    this._brightness._userSet = false

    // DDC is unreliable, so try to detect monitors multiple times
    const maxRetry = Math.clamp(this._settings.get_uint('ddcutil-retries'), 1, 10)
    for (let retry = 1; retry <= maxRetry; retry += 1) {

      const detected = await _DdcutilWrapper?.detect(1)
      const newfound = Object.keys(detected).filter(e => !(e in detectedMonitors))
      if (!newfound.length) {
        await sleep(RETRY_DELAY_MS)
        continue
      }

      detectedMonitors = {...detectedMonitors, ...detected}
      this._monitorBus = Object.keys(detectedMonitors)

      await configureValue({
        vcpCode: VCP_VOLUMEOUT,
        name: '_volume',
        enabledCb: this._showVolumeSetting.bind(this),
        bus: newfound
      })

      await configureValue({
        vcpCode: VCP_BRIGHTNESS,
        name: '_brightness',
        enabledCb: this._showBrightnessSetting.bind(this),
        bus: newfound
      })

    }

    configureNoValue({
      name: '_volume',
      disabledCb: this._showVolumeSetting.bind(this)
    })

    configureNoValue({
      name: '_brightness',
      disabledCb: this._showBrightnessSetting.bind(this)
    })

    if (isEmpty(detectedMonitors))
      LOG("Warning: no monitors found on I2C, extension sleeping")

    await this._readInitialValuesLock.release()
  }

  // optionally, the brightness slider can be disabled in the settings
  _showBrightnessSetting () {
    const show = this._brightnessAvailable && this._settings?.get_boolean('show-brightness')
    this._brightness.visible = show
    this._setBrightnessKeys(show)
  }

  // optionally, the volume slider can be disabled in the settings
  _showVolumeSetting () {
    this._settings?.set_boolean('monitor-volume-available', !!this._volumeAvailable)
    this._volume.visible = this._volumeAvailable && this._settings?.get_boolean('show-volume')
    this._updateVolumeKeysForSink()
    if (this._volumeAvailable && this._settings?.get_boolean('unify-volume'))
      this._setSystemVolume100()
  }

  // parse a shell-style argument string into an array safe for subprocess argv
  _parseExtraArgs (str) {
    if (!str?.trim()) return []
    try {
      const [ok, argv] = GLib.shell_parse_argv(str)
      return ok ? argv : []
    } catch {
      return []
    }
  }

  // returns true when headphones/headset is the active output port,
  // meaning DDC volume keys should yield to the system volume handler
  _isHeadphoneActive () {
    if (this._mixerControl?.get_state() !== Gvc.MixerControlState.READY)
      return false
    const stream = this._mixerControl.get_default_sink()
    if (!stream) return false
    const port = stream.get_port()?.port
    if (!port) return false
    return /headphone|headset/i.test(port)
  }

  // enable or disable volume keybindings depending on volume availability,
  // settings, and whether headphones are currently the active output
  _updateVolumeKeysForSink () {
    const shouldEnable = !!this._volumeAvailable &&
      !!this._settings?.get_boolean('show-volume') &&
      !this._isHeadphoneActive()
    this._setVolumeKeys(shouldEnable)
  }

  // set the default audio sink to 100% so DDC is the sole volume control
  _setSystemVolume100 () {
    if (this._mixerControl?.get_state() !== Gvc.MixerControlState.READY)
      return
    const stream = this._mixerControl.get_default_sink()
    if (!stream) return
    stream.set_volume(this._mixerControl.get_vol_max_norm())
    stream.push_volume()
  }

  // save current system volume to settings before taking control
  _saveSystemVolume () {
    if (this._mixerControl?.get_state() !== Gvc.MixerControlState.READY)
      return
    const stream = this._mixerControl.get_default_sink()
    if (!stream) return
    const normalized = stream.get_volume() / this._mixerControl.get_vol_max_norm()
    this._settings.set_double('saved-system-volume', normalized)
  }

  // restore system volume saved before unify-volume was enabled
  _restoreSystemVolume () {
    const saved = this._settings.get_double('saved-system-volume')
    if (saved < 0) return
    this._settings.set_double('saved-system-volume', -1.0)
    if (this._mixerControl?.get_state() !== Gvc.MixerControlState.READY)
      return
    const stream = this._mixerControl.get_default_sink()
    if (!stream) return
    stream.set_volume(saved * this._mixerControl.get_vol_max_norm())
    stream.push_volume()
  }

  // (dis)connect global keyboard shortcuts for monitor volume
  _setVolumeKeys (enabled) {
    if (enabled) {
      if (!this._volumeKeys) {
        this._pauseConflicts(
          this._getMediaSettings(),
          [
            ['volume-up-static',   'monitor-volume-up'],
            ['volume-up',          'monitor-volume-up'],
            ['volume-down-static', 'monitor-volume-down'],
            ['volume-down',        'monitor-volume-down'],
            ['volume-mute-static', 'monitor-volume-mute'],
            ['volume-mute',        'monitor-volume-mute'],
          ],
          '_savedMediaBindings'
        )
        Main.wm.addKeybinding('monitor-volume-up', this._settings,
          Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, this.volumeUpKey.bind(this))
        Main.wm.addKeybinding('monitor-volume-down', this._settings,
          Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, this.volumeDownKey.bind(this))
        Main.wm.addKeybinding('monitor-volume-mute', this._settings,
          Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, this.volumeMuteKey.bind(this))
        this._volumeKeys = true
      }
    } else {
      if (this._volumeKeys) {
        Main.wm.removeKeybinding('monitor-volume-up')
        Main.wm.removeKeybinding('monitor-volume-down')
        Main.wm.removeKeybinding('monitor-volume-mute')
        this._volumeKeys = false
      }
      this._resumeConflicts(this._getMediaSettings(), '_savedMediaBindings')
    }
  }

  // (dis)connect global keyboard shortcuts for monitor brightness
  _setBrightnessKeys (enabled) {
    if (enabled) {
      if (!this._brightnessKeys) {
        // GNOME Shell 47+ claims XF86MonBrightness* itself; clear those bindings
        // first so our add_keybinding wins.  The changed:: signal fires
        // synchronously within the same process, releasing the key immediately.
        this._pauseConflicts(
          this._getShellSettings(),
          [
            ['screen-brightness-up',   'monitor-screen-brightness-up'],
            ['screen-brightness-down', 'monitor-screen-brightness-down'],
          ],
          '_savedShellBindings'
        )
        Main.wm.addKeybinding(
          'monitor-screen-brightness-up',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.ALL,
          this.brightnessUpKey.bind(this)
        )
        Main.wm.addKeybinding(
          'monitor-screen-brightness-down',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.ALL,
          this.brightnessDownKey.bind(this)
        )
        this._brightnessKeys = true
      }
    } else {
      if (this._brightnessKeys) {
        Main.wm.removeKeybinding('monitor-screen-brightness-up')
        Main.wm.removeKeybinding('monitor-screen-brightness-down')
        this._brightnessKeys = false
      }
      this._resumeConflicts(this._getShellSettings(), '_savedShellBindings')
    }
  }

  // Remove entries from a system GSettings key that would prevent our
  // add_keybinding from succeeding.  Saves the original so we can restore it.
  // pairs: array of [systemSchemaKey, ourExtensionSchemaKey]
  // stateField: name of the instance property used to store the saved values
  _pauseConflicts (systemSettings, pairs, stateField) {
    for (const [sysKey, extKey] of pairs) {
      if (!systemSettings.settings_schema.has_key(sysKey)) continue
      const ours   = this._settings?.get_strv(extKey) ?? []
      const theirs = systemSettings.get_strv(sysKey)
      const hits   = theirs.filter(k => ours.includes(k))
      if (hits.length === 0) continue
      if (!this[stateField]) this[stateField] = {}
      this[stateField][sysKey] = theirs
      systemSettings.set_strv(sysKey, theirs.filter(k => !hits.includes(k)))
    }
  }

  // Restore the system GSettings entries saved by _pauseConflicts.
  _resumeConflicts (systemSettings, stateField) {
    if (!this[stateField]) return
    for (const [key, value] of Object.entries(this[stateField]))
      systemSettings.set_strv(key, value)
    this[stateField] = null
  }

  _getShellSettings () {
    if (!this._shellSettings)
      this._shellSettings = new Gio.Settings({ schema: 'org.gnome.shell.keybindings' })
    return this._shellSettings
  }

  _getMediaSettings () {
    if (!this._mediaSettings)
      this._mediaSettings = new Gio.Settings({
        schema: 'org.gnome.settings-daemon.plugins.media-keys',
      })
    return this._mediaSettings
  }

  // show a notification on the first setvcp failure per session
  _onSetVcpError (failedBuses) {
    if (this._vcpErrorNotified) return
    this._vcpErrorNotified = true
    Main.notify(
      'Monitor Brightness/Volume',
      `DDC command failed on bus ${failedBuses.join(', ')}. ` +
      'Try increasing the DDC Sleep Multiplier in settings.'
    )
  }

  // callback for the _brightness.slider::value to actually launch the
  // setBrightness ddcutil command
  async setBrightness (value) {
    this._brightness._userSet = true
    await this._setBrightnessIntent?.setValue(castInt(value), this._brightnessBusMaxRng, this._brightnessBus)
  }

  // callback for the _volume.slider::value to actually launch the
  // setVolume ddcutil command
  async setVolume (value) {
    this._volume._userSet = true
    await this._setVolumeIntent?.setValue(castInt(value), this._volumeBusMaxRng, this._volumeBus)
  }

  // GNOME 49 split OsdWindowManager.show() into showAll/showOne/show.
  // Use showAll (GNOME 49+) when available, fall back to the old show() (GNOME 46-48).
  _showOsd (iconName, label, level) {
    const icon = Gio.ThemedIcon.new(iconName)
    if (Main.osdWindowManager.showAll)
      Main.osdWindowManager.showAll(icon, label, level, 1)
    else
      Main.osdWindowManager.show(-1, icon, label, level, 1)
  }

  // methods for the global keyboard shortcuts (they change the slider value)
  _keyboardStep () {
    return (this._settings?.get_uint('keyboard-step') ?? KEYBOARD_STEP_DEFAULT) / 100
  }

  async brightnessUpKey () {
    const newValue = Math.min(1, this._brightness?.slider.value + this._keyboardStep())
    this._brightness.slider.value = newValue
    this._showOsd(this._brightness.iconName, 'Monitor', newValue)
  }

  async brightnessDownKey () {
    const newValue = Math.max(0, this._brightness?.slider.value - this._keyboardStep())
    this._brightness.slider.value = newValue
    this._showOsd(this._brightness.iconName, 'Monitor', newValue)
  }

  async volumeUpKey () {
    const newValue = Math.min(1, this._volume?.slider.value + this._keyboardStep())
    this._volume.slider.value = newValue
    this._showOsd(this._volume.iconName, 'Monitor', newValue)
  }

  async volumeDownKey () {
    const newValue = Math.max(0, this._volume?.slider.value - this._keyboardStep())
    this._volume.slider.value = newValue
    this._showOsd(this._volume.iconName, 'Monitor', newValue)
  }

  async volumeMuteKey () {
    const currentValue = this._volume?.slider.value ?? 0
    let newValue
    if (currentValue > 0) {
      this._volumeMuteRestoreValue = currentValue
      newValue = 0
    } else {
      newValue = this._volumeMuteRestoreValue ?? 0.5
    }
    this._volume.slider.value = newValue
    this._showOsd(this._volume.iconName, 'Monitor', newValue)
  }

  // callback when a change in monitor configuration was detected
  _monitorsChanged () {
    if (this._monitorsChangedId)
      clearTimeout(this._monitorsChangedId)
    LOG(`Please wait (${MONITORS_CHANGED_SETTLE_MS}ms) for i2c to clear`)
    this._monitorsChangedId = setTimeout(async () => {
      this._monitorsChangedId = null
      await this._readInitialValues()
    }, MONITORS_CHANGED_SETTLE_MS)
  }

  enable () {
    const settings = this.getSettings()
    const customPath = settings.get_string('ddcutil-path').trim()
    const ddcutilBin = customPath || 'ddcutil'
    if (!GLib.find_program_in_path(ddcutilBin)) {
      LOG(`ddcutil not found: ${ddcutilBin}`)
      Main.notify(
        'Monitor Brightness/Volume',
        customPath
          ? `ddcutil not found at '${customPath}'. Please check the path in settings.`
          : 'ddcutil not found. Please install ddcutil and ensure it is in your PATH.'
      )
      return
    }

    _DdcutilWrapper = new DdcutilWrapper(
      settings.get_double('ddcutil-sleep-multiplier'),
      settings.get_string('ddcutil-path').trim()
    )
    _DdcutilWrapper.additionalArgs = this._parseExtraArgs(settings.get_string('ddcutil-extra-args'))
    _DdcutilHelper = new DdcutilHelper(_DdcutilWrapper)
    this._injectionManager = new InjectionManager()

    this._readInitialValuesLock = new Lock()
    this._vcpErrorNotified = false
    this._setBrightnessIntent = new SetValueIntent(
      _DdcutilHelper._setVcpAllScaleInt.bind(_DdcutilHelper), VCP_BRIGHTNESS)
    this._setBrightnessIntent.onError = this._onSetVcpError.bind(this)
    this._setVolumeIntent = new SetValueIntent(
      _DdcutilHelper._setVcpAllScaleInt.bind(_DdcutilHelper), VCP_VOLUMEOUT)
    this._setVolumeIntent.onError = this._onSetVcpError.bind(this)

    this._brightness = new MVBrightnessItem(this)
    this._brightness.visible = false

    this._volume = new MVVolumeItem(this)
    this._volume.visible = false

    this._settings = settings
    this._settingsSignals = []
    this._settingsSignals.push(
      this._settings.connect('changed::show-brightness', this._showBrightnessSetting.bind(this)))
    this._settingsSignals.push(
      this._settings.connect('changed::show-volume', this._showVolumeSetting.bind(this)))
    this._settingsSignals.push(
      this._settings.connect('changed::unify-volume', () => {
        if (this._settings.get_boolean('unify-volume')) {
          this._saveSystemVolume()
          if (this._volumeAvailable)
            this._setSystemVolume100()
        } else {
          this._restoreSystemVolume()
        }
      }))

    this._mixerControl = new Gvc.MixerControl({ name: 'monitor-control' })
    this._mixerStateId = this._mixerControl.connect('state-changed', (_control, state) => {
      if (state === Gvc.MixerControlState.READY &&
          this._volumeAvailable && this._settings?.get_boolean('unify-volume'))
        this._setSystemVolume100()
    })
    this._mixerDefaultSinkId = this._mixerControl.connect('default-sink-changed', () => {
      this._updateVolumeKeysForSink()
      if (this._settings?.get_boolean('unify-volume'))
        this._setSystemVolume100()
    })
    this._mixerActiveOutputId = this._mixerControl.connect('active-output-update', () => {
      this._updateVolumeKeysForSink()
    })
    this._mixerControl.open()
    this._settingsSignals.push(
      this._settings.connect('changed::ddcutil-sleep-multiplier', () => {
        _DdcutilWrapper.sleepMultiplier = this._settings.get_double('ddcutil-sleep-multiplier')
      }))
    this._settingsSignals.push(
      this._settings.connect('changed::ddcutil-extra-args', () => {
        _DdcutilWrapper.additionalArgs = this._parseExtraArgs(
          this._settings.get_string('ddcutil-extra-args'))
      }))
    this._settingsSignals.push(
      this._settings.connect('changed::ddcutil-path', () => {
        _DdcutilWrapper.binaryPath = this._settings.get_string('ddcutil-path').trim()
      }))

    // disable ourselves on logout so that any ddcutil processes that
    // are still active get killed
    this._shutdownSignal = global.connect('shutdown', this.disable.bind(this))

    // add our sliders to the QuickSettings menu
    const qsMenu = Main.panel.statusArea.quickSettings
    const addQsItems = () => {
      qsMenu._addItemsBefore([this._volume], qsMenu._volumeOutput.quickSettingsItems.at(-1), 2)
      qsMenu._addItemsBefore([this._brightness], qsMenu._brightness.quickSettingsItems.at(-1), 2)
    }

    if (qsMenu._volumeOutput) { // && qsMenu._brightness
      // VolumeStatus.OutputIndicator exists
      addQsItems()
    } else {
      // gnome-shell did not finish importing network.js in
      // QuickSettings._setupIndicators yet. Listen to calls to
      // _addItemsBefore until we have all the indicators we need
      const self = this
      this._injectionManager.overrideMethod(
        qsMenu, '_addItemsBefore', originalMethod => function (items, sibling, colSpan = 1) {
          originalMethod.call(this, items, sibling, colSpan)
          if (qsMenu._brightness && items === qsMenu._brightness.quickSettingsItems) {
            // the BrightnessStatus.Indicator is the last wide
            // indicator in gnome-shell 45, now we can add ours
            self._injectionManager.clear()
            addQsItems()
          }
        }
      )
    }

    const startup = () => {
      if (this._startupCompleteSignal) {
        Main.layoutManager.disconnect(this._startupCompleteSignal)
        this._startupCompleteSignal = null
      }

      (async () => {
        await this._readInitialValues()

        // listen for changes in monitor configuration, to re-trigger monitor detection
        this._monitorsChangedSignal = Main.layoutManager.connect(
          'monitors-changed', this._monitorsChanged.bind(this))
      })()
        .catch(e => { LOG("error in _readInitialValues: " + e) })
    }

    // if mutter starts and the screens are being detected, our
    // extension launches too early and can break the display
    // detection because of I2C bus congestion
    if (Main.layoutManager._startingUp) {
      LOG(`Please wait (for startup-complete) for i2c to clear`)
      this._startupCompleteSignal = Main.layoutManager.connect(
        'startup-complete', startup)
    } else {
      if (this._startupId)
        clearTimeout(this._startupId)
      LOG(`Please wait (${MONITORS_CHANGED_SETTLE_MS}ms) for i2c to clear`)
      this._startupId = setTimeout(startup, MONITORS_CHANGED_SETTLE_MS)
    }
  }

  disable () {
    this._injectionManager.clear()
    this._injectionManager = null

    if (this._shutdownSignal) {
      global.disconnect(this._shutdownSignal)
      this._shutdownSignal = null
    }

    if (this._monitorsChangedId) {
      clearTimeout(this._monitorsChangedId)
      this._monitorsChangedId = null
    }

    if (this._startupId) {
      clearTimeout(this._startupId)
      this._startupId = null
    }

    clearAllTimeouts()

    if (this._startupCompleteSignal) {
      Main.layoutManager.disconnect(this._startupCompleteSignal)
      this._startupCompleteSignal = null
    }

    if (this._monitorsChangedSignal) {
      Main.layoutManager.disconnect(this._monitorsChangedSignal)
      this._monitorsChangedSignal = null
    }

    for (const id of this._settingsSignals ?? [])
      this._settings.disconnect(id)
    this._settingsSignals = null
    this._settings = null

    if (this._mixerStateId) {
      this._mixerControl.disconnect(this._mixerStateId)
      this._mixerStateId = null
    }
    if (this._mixerDefaultSinkId) {
      this._mixerControl.disconnect(this._mixerDefaultSinkId)
      this._mixerDefaultSinkId = null
    }
    if (this._mixerActiveOutputId) {
      this._mixerControl.disconnect(this._mixerActiveOutputId)
      this._mixerActiveOutputId = null
    }
    this._mixerControl = null

    this._setBrightnessKeys(false)
    this._setVolumeKeys(false)

    this._brightness.destroy()
    this._volume.destroy()

    this._brightness = null
    this._volume = null

    this._readInitialValuesLock = null
    this._setBrightnessIntent = null
    this._setVolumeIntent = null

    _DdcutilHelper = null

    _DdcutilWrapper._pm.killAllRunningProcesses()
    _DdcutilWrapper = null
  }
}
