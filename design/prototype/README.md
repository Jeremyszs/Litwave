# Litwave UI/UX redesign prototype

A clickable, standalone mock-up of the proposed redesign, in light and dark themes. It is **not wired to the app**: there is no audio engine or MIDI, and song, setlist and lyric text are placeholders.

## Open it

Double-click `index.html` (or open it in any modern browser). No install or build step is needed, and nothing here is loaded by the app itself.

| Page | What it shows |
|---|---|
| `index.html` | Start page linking to the three screens |
| `studio.html` | Desktop studio: transport, chord view with countdown, lyrics, MIDI keyboard, mixer, scenes, drone pad, command palette |
| `remote.html` | Phone stage remote: Stage, Pads, Mix and Setlist tabs. Shown in a phone frame on desktop and full screen on a phone |
| `tokens.html` | Design tokens: colours for both themes, type scale, radius, spacing, motion |

Shortcuts on the studio page: `Ctrl K` / `⌘K` opens the command palette, `Space` plays or pauses, `←` / `→` seek 5 seconds.

The theme follows your system setting the first time and is then remembered across pages. Fonts load from Google Fonts. Offline, the pages fall back to system fonts.

## Files

- `theme.css`: design tokens (`[data-theme="dark"]` / `[data-theme="light"]`) and shared components (buttons, segmented control, switch, slider, chip, toast, motion).
- `theme.js`: theme switching, toasts and the icon set, shared by every page.
