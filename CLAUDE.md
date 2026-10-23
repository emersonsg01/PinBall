# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"Neon Orbit" — a synthwave pinball game in vanilla HTML/CSS/JS with a custom canvas physics engine. No build step, package manager, linter, or test suite. External dependency: Google Fonts (Orbitron, Inter, Press Start 2P), with system fallbacks. UI text is in Brazilian Portuguese.

## Running

Serve the folder statically and open it, e.g. `python -m http.server 8765` (also configured in `.claude/launch.json` as `pinball`). Opening `index.html` via `file://` works in a normal browser, but the Claude browser pane shows `file://` pages as static snapshots without running scripts.

## Architecture

Everything lives in `script.js` as classic-script globals (no modules), organized in sections:

- **Coordinates:** the table is a fixed logical space of 600×1000 (y down). `layout()` sizes the canvas to the viewport and sets `scale`; all drawing and physics use logical units. `MIRROR` (x' = 555 − x) mirrors left-side geometry to the right.
- **Geometry (`buildTable`)** fills the `T` object: `T.walls` are line segments, the only static colliders. Each has a `kind` (`wall`, `sling`, `standup`, `drop`) and an optional `owner` object, and segments whose owner has `down: true` are skipped. `oneWay` segments (the launcher gate) collide only from the side their normal points to. `T.tubes` are the polylines drawn as neon tubes. Adding a collider means adding segments here. Bumpers, the saucer and the sensors (rollovers and orbit) are circles handled separately.
- **Physics:** fixed step `STEP` = 1/600 s, run from an accumulator in `frame()`. `resolve()` is the single impulse routine; flippers pass their surface velocity (ω × r) into it, which is what gives shots their power. `Flipper.collide` treats the flipper as a tapered capsule.
- **Two loops:** `physicsStep(dt)` runs collisions, sensors and drains. `update(dt)` runs once per frame: timers (`later()`), auto-launch queue (`G.pendingAuto`), saucer-captured balls, stuck-ball kicks, effects and the demo autopilot.
- **Rules:** game state is the `G` object. Hit handlers (`bumperHit`, `dropHit`, `laneHit`, `saucerCapture`, …) mutate `G` and call `addScore` and `say`. Both are no-ops outside `G.mode === 'playing'`, so the same physics and rules drive the attract-mode demo (`autopilot`) without scoring. `Sound.play` is also silent outside play.
- **Ball lifecycle:** `serveBall()` puts a ball in the launcher. `launchBall()` arms the ball save and skill shot on a ball's first launch (`b.fresh`). `drainBall()` decides between ball save, continuing multiball, and `endOfBall()` → `nextBall()` / `gameOver()`. A locked ball (`b.lockRemove`) is removed without counting as a drain.
- **Rendering:** `renderStatic()` draws the background, art and tubes once per resize into `staticCanvas`, and `render()` draws dynamic parts on top each frame. Glows use cached radial sprites (`glow()`) with `lighter` compositing rather than `shadowBlur`, for performance. The `DMD` object draws text into a 128×32 offscreen canvas and re-renders it as LED dots; `DMD.message()` queues messages (`now: true` interrupts).
- **DOM:** side panels (hidden under 1100px wide) are updated from `G` by `updateUI()` at about 10 Hz. Overlay screens are toggled with `showScreen('start' | 'pause' | 'over' | null)`. High scores are stored in `localStorage` (`neonOrbit.highscores`) inside try/catch.

## Testing changes

There are no automated tests. The practical way to check physics or rule changes is to fast-forward the simulation from the browser console. Set `G.paused = true`, then loop `update(1/60); autopilot(1/60); for (10×) physicsStep(STEP)`, launching lane balls with `launchBall(b, power)`. Watch for balls outside the outer wall, inside bumpers, or with `b.stuck` rising, which means a geometry pocket.
