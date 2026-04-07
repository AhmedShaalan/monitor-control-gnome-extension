// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2025 Ahmed Shaalan

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import './shortcut.js';

const PrefsWidget = GObject.registerClass({
    GTypeName: 'MBVPrefsWidget',
    Template: GLib.Uri.resolve_relative(import.meta.url, './ui/prefs.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'show_brightness_row',
        'show_volume_row',
        'unify_volume_row',
        'unify_volume_warning_row',
        'ddcutil_retries_row',
        'sleep_multiplier_row',
        'ddcutil_path_row',
        'ddcutil_extra_args_row',
        'keyboard_step_row',
        'brightness_up_button',
        'brightness_down_button',
        'volume_up_button',
        'volume_down_button',
        'volume_mute_button',
    ],
}, class PrefsWidget extends Adw.PreferencesPage {
    _init(settings, params = {}) {
        super._init(params);
        this._settings = settings;

        this._settings.bind(
            'show-brightness',
            this._show_brightness_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._settings.bind(
            'show-volume',
            this._show_volume_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._settings.bind(
            'unify-volume',
            this._unify_volume_row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        const updateUnifyWarning = () => {
            const unify = this._settings.get_boolean('unify-volume');
            const available = this._settings.get_boolean('monitor-volume-available');
            this._unify_volume_warning_row.visible = unify && !available;
        };
        this._settings.connect('changed::unify-volume', updateUnifyWarning);
        this._settings.connect('changed::monitor-volume-available', updateUnifyWarning);
        updateUnifyWarning();

        this._ddcutil_retries_row.value = this._settings.get_uint('ddcutil-retries');
        this._sleep_multiplier_row.value = this._settings.get_double('ddcutil-sleep-multiplier');

        this._settings.bind(
            'ddcutil-path',
            this._ddcutil_path_row,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'ddcutil-extra-args',
            this._ddcutil_extra_args_row,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._keyboard_step_row.value = this._settings.get_uint('keyboard-step');

        this._bindShortcut('monitor-screen-brightness-up', this._brightness_up_button);
        this._bindShortcut('monitor-screen-brightness-down', this._brightness_down_button);
        this._bindShortcut('monitor-volume-up', this._volume_up_button);
        this._bindShortcut('monitor-volume-down', this._volume_down_button);
        this._bindShortcut('monitor-volume-mute', this._volume_mute_button);
    }

    _bindShortcut(settingsKey, widget) {
        this._settings.connect(`changed::${settingsKey}`, () => {
            widget.keybinding = this._settings.get_strv(settingsKey)[0] ?? '';
        });
        widget.connect('notify::keybinding', () => {
            this._settings.set_strv(settingsKey, widget.keybinding ? [widget.keybinding] : []);
        });
        widget.keybinding = this._settings.get_strv(settingsKey)[0] ?? '';
    }

    onRetriesValueChanged() {
        this._settings.set_uint('ddcutil-retries', this._ddcutil_retries_row.value);
    }

    onSleepMultiplierValueChanged() {
        this._settings.set_double('ddcutil-sleep-multiplier', this._sleep_multiplier_row.value);
    }

    onKeyboardStepValueChanged() {
        this._settings.set_uint('keyboard-step', this._keyboard_step_row.value);
    }
});

export default class MonitorBrightnessVolumePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_size_request(500, 600);
        window.search_enabled = true;
        window.add(new PrefsWidget(settings));
    }
}
