# Synova-R136a1

A self-contained WebGL orb study. Serve this directory over HTTP; no package installation is needed to run it:

```sh
python3 -m http.server 4170 --bind 127.0.0.1
```

Open `http://127.0.0.1:4170/`. WebGL2 is required. Keep `assets/basis/` beside the other assets when deploying or bundling; its decoder filenames must remain unchanged. A Vite build requires the `esnext` target for the module's top-level await.

## Motion and opening

Simulation uses 60 Hz fixed steps independently of rendering. Presentation follows the browser’s measured refresh rate, with interpolated motion between simulation steps. Short gaps catch up elapsed simulation time before rendering; hidden tabs and gaps of at least one second pause the scene instead of running a large burst on return.

The opening stays white for at least 500 ms and until textures, fonts, shaders, and the first complete scene frame are ready. The two-second fade shares progress with the camera's eased approach and the existing fly-in. Failed initialization stays covered and displays a reload message.

The introduction starts one second after the opening finishes. It uses the existing Instrument Sans font and theme colors, with centered, responsive wrapping. The seven-sentence sequence reveals characters, shifts grouped lines, and fades away after “Take care out there.” Replay opening restarts it; suspension pauses its reading time. Reduced motion shows whole sentences without movement or blur. Text remains non-selectable.

Initial rendering density uses `min(devicePixelRatio, 2)`. Performance adaptation uses measured CPU cost, GPU cost, and frame delivery; GPU names never affect decisions. Orb and particle base rotation rates remain 0.120 and 0.300 radians per second. Pointer speed is normalized by the viewport diagonal and boosts particles up to 2× and orb/cloud motion up to 3×, with 125 ms attack and 500 ms release time constants.

## Visual tuning


Transfer `theme` values into `js/themes.js`, `scene` values into the corresponding entries in `js/initial-values.js`, and `motion` / `opening` into `js/context.js`. Particle-count controls change draw counts within the existing buffers; they do not resize simulation capacity.

There is one bloom pass. The unused extra bloom configuration and controls have been removed.

Inner particles retain transparent rendering even at full global opacity: their shader still uses per-particle life/cloud alpha. The translucent orb shell does not write to the depth buffer, so it cannot occlude those interior particles. These scene defaults apply with or without the tuning panel; opacity edits and resets preserve them.

## Performance qualification

A lightweight RAF probe runs before scene initialization. Median/MAD filtering rejects stalls and invalid intervals, then cadence is estimated from retained interval count over retained duration. This keeps quantized 4/5 ms timestamps near their actual 240 Hz rate instead of misclassifying them as 250 Hz. The robust observed rate and nominal snapped rate are reported separately; snapping uses a 4% tolerance.

Synova-R136a1 starts at native cadence and Q0. Performance qualification begins only after `synova-r136a1:opening-complete` and a settling period, so initialization, shader compilation, reveal and camera animation cannot cause initial demotion. Complete presentation-interval GPU work is measured asynchronously, alongside CPU submission cost and delivery in configuration-tagged windows. Missing GPU timers are reported explicitly.

Sustained overload first tests Q1 at the current cadence. If that is insufficient, the next integer-divisor cadence is tested at Q0. Q0/Q1 are tried at every rate above the lowest divisor still at least 60 Hz; Q2 becomes eligible at that boundary and below. Q3 is reserved for the cadence floor. For example, 144 Hz tests `144/Q0 → 144/Q1 → 72/Q0 → 72/Q1 → 72/Q2 → 48/Q0`, while 240 Hz tests Q0/Q1 at 240, 120 and 80 Hz before allowing Q2 at 60 Hz. These are measured stages, not automatic steps through the entire ladder. Simulation remains fixed at 60 Hz with interpolated presentation.

CPU or reliable GPU p95 load above 92% requires two consecutive windows. Delivery alone requires either delivery below 88% with at least six missed opportunities, or at least 6% late intervals with at least six late intervals, across three consecutive windows and at least six measured seconds. A small delivery deficit or isolated late frame cannot demote the scene or roll back a promotion. Recovery requires at least 15 measured seconds and five consecutive windows with clear headroom, testing the immediately preceding cadence/quality candidate in the same ladder. Trials validate two sustainable windows; failed promotions restore the previous pair and cool down that candidate for 60 seconds. Inconclusive trials end after 12 measured seconds: promotions restore, demotions keep their reduced pair.


Opening replay, theme/tuning changes, ordinary resize, visibility recovery and context restoration preserve the current adaptive pair while settling fresh measurements. Ordinary resize reapplies effective quality without probing cadence. Meaningful DPR changes, persistent RAF cadence shifts over 5%, prolonged hidden-state return and context restoration may reprobe. A changed native classification remaps the cadence to an allowed divisor while keeping the current quality within its eligible range.


## Desktop tools

Performance and Visual Tuning initially fit their content when viewport space permits; smaller screens keep bounded windows with vertical scrolling. Manual resizing remains available.

Two round buttons at the top-right open **Performance** and **Visual Tuning**. `?perf` and `?tune` remain auto-open aliases. Tools are available on desktop with a fine pointer and hover; mobile/tablet/coarse-pointer layouts do not show them. Themes are selected only from the custom page right-click menu, also available with the Menu key or Shift+F10.

Each tool is an independent floating window. Drag any noninteractive area with either mouse button; resize from any edge or corner. Groups reflow into columns as the window grows, with internal scrolling when needed. Pin a window to keep it open while interacting elsewhere. Unpinned windows close on outside pointer interaction. Escape closes the theme menu first, otherwise only the foremost unpinned window. Close and reopen resets geometry and pin state; nothing is stored. Windows stay below the launcher strip, inside the viewport.

A stationary right-click in a group's noninteractive area copies the whole group as readable `Label: value` lines. Tuning copies include stable control IDs and precise current values. Moving more than 5 CSS pixels instead drags the window. Copying has one shared three-second cooldown across both tools; repeat attempts during cooldown are silent. Native context menus, text selection, clipboard shortcuts/paste and text/image dragging are suppressed. Numeric inputs still support typing, focus and arrow keys.

Visual Tuning retains Reset and Replay opening. Double-click a slider or numeric input to restore that control's active-theme baseline; a subtle cue indicates default values. Performance decision evidence and its delivery/late/missed metrics refer to the same completed classified window. Any separately shown live measurements are labeled as current-window data.

## Legal pages

Small links at the bottom right open `privacy/index.html` and `terms/index.html`. These pages preserve the supplied policy text and use relative links and the bundled font. `robots.txt` is published at the project root; GitHub project Pages exposes it under `/Synova-R136a1/`, whereas crawler rules normally require the host-root `/robots.txt`. The HTML pages also carry `noindex` directives.

## Checks

```sh
npm test
npm run test:browser
```

The tests cover refresh-rate independence, interpolation, cadence classification and divisors, asynchronous GPU accounting, adaptation and recovery, configuration isolation, requested/effective settings, catch-up/pause behavior, pointer response, camera easing, and particle visibility across themes. Rendered acceptance also requires a WebGL2 browser: verify inner particles, theme appearance, the reveal, live controls, reset/copy/replay, and desktop/mobile layouts.

`js/renderer.js` contains the existing bundled renderer and libraries; changes to it are limited to the requested animation/rendering behavior and removal of obsolete quality and extra bloom machinery. Preserve `NOTICE.txt` and the asset licenses.

## Publishing

The public repository is https://github.com/dv8pw/Synova-R136a1. GitHub Pages serves `main` from the repository root at https://dv8pw.github.io/Synova-R136a1/. No build step is required; asset and module URLs stay relative so the project subpath works.

