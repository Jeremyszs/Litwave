# Litwave showreel

A one-minute promo for Litwave in which every frame, note and sound effect is generated in code. There is no stock footage, no samples and no audio files.

## Watch it live

Open `showreel.html` in a browser and press **Play showreel** (or Space). The visuals follow the audio clock, so the chords on screen are the chords you hear.

## Render it to video

```bash
node render.mjs litwave-showreel.mp4            # 1920x1080, 60 fps, H.264 + AAC
node render.mjs litwave-showreel.mp4 --fps 30   # lighter render
node render.mjs stills/ --stills 10.9,15.6,42.6 # JPEG stills at chosen times
node render.mjs mix.wav --audio-only            # just the soundtrack
node render.mjs drums.wav --audio-only --solo drums   # one stem: drums, music or sfx
```

Needs Node, Playwright with a Chromium, and `ffmpeg` with libx264 on `PATH`. Set `CHROMIUM_PATH` to use a specific Chromium binary. The audio is rendered faster than real time with `OfflineAudioContext`. Video frames are rendered one at a time from `render(t)` and piped to ffmpeg, so the output never drops a frame, however slow the machine is.

## How it's built

- **One timeline.** `render(t)` draws a frame as a pure function of time. `buildScore()` returns the musical and sound-design events as data. The visuals read the same data (kick times, electric-piano stabs, pad hits), so every flash, pulse and chord change lands on the beat.
- **Music** (120 BPM, E major, I–V–vi–IV):
  - detuned-saw pads with filter sweeps
  - an FM electric piano
  - an offbeat saw-and-sine bass, ducked under the kick
  - synthesized kick, clap, hats and a snare roll
  - a sixteenth-note arpeggio and a lead melody
- **Sound design:** noise risers with a rising saw layer and auto-pan, reverse cymbals, sub-drop impacts with crash tails, band-passed stereo whooshes, FM bells, formant vox chops, a tape stop, scan sweeps and UI ticks.
- **Mix:**
  - generated stereo convolution reverb and a ping-pong delay
  - a bus compressor, master EQ and a limiter
  - mastered to about -14 LUFS integrated with peaks under -1.5 dBFS
- **Story:**
  1. the hook ("what comes next")
  2. logo drop
  3. live chord view
  4. song analysis
  5. FX pads
  6. phone remote, with a light/dark theme wipe
  7. full studio montage
  8. outro

The palette and type match the redesign prototype in `design/prototype/`.
