// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2025 Ahmed Shaalan

import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function isKeyvalForbidden(keyval) {
    const forbiddenKeyvals = [
        Gdk.KEY_Home,
        Gdk.KEY_Left,
        Gdk.KEY_Up,
        Gdk.KEY_Right,
        Gdk.KEY_Down,
        Gdk.KEY_Page_Up,
        Gdk.KEY_Page_Down,
        Gdk.KEY_End,
        Gdk.KEY_Tab,
        Gdk.KEY_KP_Enter,
        Gdk.KEY_Return,
        Gdk.KEY_BackSpace,
        Gdk.KEY_Mode_switch,
    ];
    return forbiddenKeyvals.includes(keyval);
}

function isBindingValid({mask, keycode, keyval}) {
    if ((mask === 0 || mask === Gdk.SHIFT_MASK) && keycode !== 0) {
        if (
            (keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
            (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
            (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
            (keyval >= Gdk.KEY_kana_fullstop && keyval <= Gdk.KEY_semivoicedsound) ||
            (keyval >= Gdk.KEY_Arabic_comma && keyval <= Gdk.KEY_Arabic_sukun) ||
            (keyval >= Gdk.KEY_Serbian_dje && keyval <= Gdk.KEY_Cyrillic_HARDSIGN) ||
            (keyval >= Gdk.KEY_Greek_ALPHAaccent && keyval <= Gdk.KEY_Greek_omega) ||
            (keyval >= Gdk.KEY_hebrew_doublelowline && keyval <= Gdk.KEY_hebrew_taf) ||
            (keyval >= Gdk.KEY_Thai_kokai && keyval <= Gdk.KEY_Thai_lekkao) ||
            (keyval >= Gdk.KEY_Hangul_Kiyeog && keyval <= Gdk.KEY_Hangul_J_YeorinHieuh) ||
            (keyval === Gdk.KEY_space && mask === 0) ||
            isKeyvalForbidden(keyval)
        )
            return false;
    }
    return true;
}

function isAccelValid({mask, keyval}) {
    // XF86/media keys (e.g. MonBrightnessUp, AudioRaiseVolume) have keysyms
    // above 0x1000000 and are valid accelerators without any modifier
    if (mask === 0 && keyval > 0x1000000)
        return true;
    return Gtk.accelerator_valid(keyval, mask) || (keyval === Gdk.KEY_Tab && mask !== 0);
}

const ShortcutWidget = GObject.registerClass({
    GTypeName: 'MBVShortcutWidget',
    Template: GLib.Uri.resolve_relative(import.meta.url, './ui/shortcut.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'set_button',
        'shortcut_label',
        'change_button',
        'clear_button',
        'dialog',
        'shortcut_info_label',
        'shortcut_entry',
        'suggestion_section',
        'suggestion_section_label',
        'suggestion_button',
    ],
    Properties: {
        keybinding: GObject.ParamSpec.string(
            'keybinding',
            'Keybinding',
            'Key sequence',
            GObject.ParamFlags.READWRITE,
            null
        ),
        suggestion: GObject.ParamSpec.string(
            'suggestion',
            'Suggestion',
            'Suggested key name to pre-fill',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'suggestion-label': GObject.ParamSpec.string(
            'suggestion-label',
            'Suggestion Label',
            'Label shown above the suggestion button',
            GObject.ParamFlags.READWRITE,
            ''
        ),
    },
}, class ShortcutWidget extends Gtk.Stack {
    onKeybindingChanged(button) {
        button.visible_child_name = button.keybinding ? 'active' : 'set';
    }

    _openDialog() {
        this._shortcut_info_label.set_text(_('Press the key combination…'));
        this._shortcut_entry.text = '';
        const suggestion = this.suggestion;
        if (suggestion) {
            this._suggestion_section_label.set_text(this['suggestion-label'] || suggestion);
            this._suggestion_button.label = suggestion;
            this._suggestion_section.visible = true;
        } else {
            this._suggestion_section.visible = false;
        }
        this._dialog.transient_for = this.get_root();
        this._dialog.present();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._dialog.set_focus(null);
            return GLib.SOURCE_REMOVE;
        });
    }

    onSuggestionButtonClicked(_button) {
        this.keybinding = this.suggestion;
        this._dialog.close();
    }

    _applyTypedShortcut() {
        const text = this._shortcut_entry.text.trim();
        if (!text)
            return;

        const [ok, keyval] = Gtk.accelerator_parse(text);
        if (!ok || keyval === 0) {
            this._shortcut_info_label.set_text(_('Invalid shortcut, try again'));
            return;
        }

        this.keybinding = text;
        this._dialog.close();
    }

    onShortcutEntryActivated(_entry) {
        this._applyTypedShortcut();
    }

    onApplyButtonClicked(_button) {
        this._applyTypedShortcut();
    }

    onSetButtonClicked(_button) {
        this._openDialog();
    }

    onChangeButtonClicked(_button) {
        this._openDialog();
    }

    onClearButtonClicked(_button) {
        this.keybinding = '';
    }

    onKeyPressed(_widget, keyval, keycode, state) {
        let mask = state & Gtk.accelerator_get_default_mod_mask();
        mask &= ~Gdk.ModifierType.LOCK_MASK;

        if (keyval === Gdk.KEY_Escape) {
            this._dialog.close();
            return Gdk.EVENT_STOP;
        }

        if (!isBindingValid({mask, keycode, keyval}) || !isAccelValid({mask, keyval})) {
            this._shortcut_info_label.set_text(_('Reserved or invalid binding, try another'));
            return Gdk.EVENT_STOP;
        }

        this._shortcut_entry.text = Gtk.accelerator_name_with_keycode(
            null,
            keyval,
            keycode,
            mask
        );
        this._shortcut_info_label.set_text(_('Press the key combination…'));

        return Gdk.EVENT_STOP;
    }
});
