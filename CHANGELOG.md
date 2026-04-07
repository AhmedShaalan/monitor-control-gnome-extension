# Changelog

## 1

### Added
- Preferences window with Adwaita UI (`prefs.js`, `ui/prefs.ui`)
- Show/hide toggles for brightness and volume sliders in preferences
- Keyboard shortcut configuration in preferences with live key capture dialog
  - Captured key combo reflected in text field before confirming
  - Manual text entry fallback for keys that can't be captured (e.g. bare XF86 media keys)
  - "Or use brightness key" / "Or use volume key" preset buttons for each shortcut row
- `show-brightness` setting: toggle brightness slider visibility
- `keyboard-step` setting: configurable step size (1–20%) for keyboard shortcuts (default: 5%)
- `ddcutil-sleep-multiplier` setting: multiplies DDC sleep intervals to help with slow monitors (default: 1.0)
- `ddcutil-extra-args` setting: additional arguments passed to every ddcutil invocation
- `unify-volume` setting: sets system volume to 100% via `Gvc.MixerControl` and uses monitor DDC as the sole volume control
  - Applied on toggle, on extension start, and on every volume keyboard shortcut
  - Reapplied automatically when the default audio sink changes
  - Warning shown in prefs when monitor volume is not detected via DDC
- Notification when `ddcutil` is not found in `$PATH` on extension enable
- Translation infrastructure (`po/` directory with POTFILES and template)
- `README.md` with installation instructions, settings reference, and troubleshooting
- `CHANGELOG.md`
- `.gitignore`

### Changed
- `keyboard-step` default changed from 2% to 5%
- `keyboard-step` is now a user-configurable preference instead of a hardcoded constant
- `ddcutil --sleep-multiplier` is now passed to all ddcutil invocations
- DDC options (retries, sleep multiplier, extra args) moved to an Advanced section in preferences
- `conveniencePref.js` folded into `shortcut.js`

## 13 (previous release)

Upstream release. See https://gitlab.gnome.org/Nei/gnome-shell-extension-monitor-brightness-volume/-/releases
