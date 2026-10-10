# Third-party notices

## FanBox upstream

fanbox-pro is a Windows derivative of [FanBox by alchaincyf / 花叔](https://github.com/alchaincyf/fanbox). Its file browser, preview/editor, embedded terminal and application structure are based on FanBox. The upstream MIT copyright and license are preserved in `LICENSE`. This derivative independently adds Windows adaptations, workspace Git management and task scheduling.

## Theme palettes

The built-in theme palettes in `public/themes/terax-builtin.json` and
`public/themes/terax-builtin.js` are adapted from Terax AI (`terax-ai-main`).
The original light/dark UI and terminal palettes are preserved, including the
default palette originally defined in `src/styles/globals.css`.
Terax AI is licensed under Apache License 2.0; a copy is included in
`public/themes/LICENSE-terax.txt`. Fanbox's theme application and settings UI
adapt these palettes to its own CSS variables, Electron menus and xterm.

`public/themes/editor-palettes.js` adapts Terax AI's local CodeMirror syntax
palettes and the `@uiw/codemirror-theme-*` version 4.25.11 palettes to Monaco
tokens. The original CodeMirror token categories are mapped to corresponding
Monaco categories. The UIW palettes are MIT licensed; their license is included
in `public/themes/LICENSE-uiw.txt`.
