// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2025 Ahmed Shaalan

import GObject from 'gi://GObject'

import {MVSliderItem} from './sliderItem.js'
import {LOG} from '../utils.js'

// Brightness slider
export const MVBrightnessItem = GObject.registerClass(
class MVBrightnessItem extends MVSliderItem {

  _init (extension) {
    super._init('display-brightness-symbolic', extension)

    this._sliderChangedSignal = this.slider.connect(
      'notify::value', this._sliderChanged.bind(this))
    this.slider.accessible_name = _('Brightness')
  }

  _sliderChanged () {
    const percent = this.slider.value * 100
    this._extension?.setBrightness(percent).catch(e => { LOG("error: " + e) })
  }

  // method to change the slider without triggering the value changed
  // signals
  _changeSlider (percent) {
    this.slider.block_signal_handler(this._sliderChangedSignal)
    this.slider.value = percent / 100
    this.slider.unblock_signal_handler(this._sliderChangedSignal)
  }

})
