# Nitro Circuit Overdrive — full handoff for Codex

**Written 2026-08-11 by Claude (Opus 5) at the end of a long build session.**
Everything you need is in this file or in this repo. It assumes **no** access to
`~/.claude` — all lessons that lived in Claude's memory store are inlined below.

---

## 1. What this is

A 2.5D arcade racer — TypeScript + Vite + Three.js 0.165, no game engine, no
backend. Runs entirely in the browser.

- **Visual bar:** *art of rally* (funselektor) — flat-shaded low-poly, strong
  colour scripting, atmospheric. Gameplay DNA: Super Cars / Horizon Chase.
- **Kol's standing instruction:** "10/10 or nothing — AAA *quality*, not AAA scope."

### Where it lives

| Thing | Location |
|---|---|
| Canonical repo | `https://github.com/koltregaskes/nitro-circuit-overdrive` (public) |
| Kol's copy (NAS) | `W:\200-build-room\Projects\nitro-circuit-overdrive` |
| Local dev clone | `C:\dev\nitro` |
| Live game | `https://koltregaskes.github.io/nitro-circuit-overdrive/` |
| Also listed on | `https://elusionworks.com/demos` (card added; that site's repo is `koltregaskes/elusion-works`) |
| Linear epic | **KOL-4818** (gauntlet) under parent **KOL-4160**; predecessors KOL-4425, KOL-4709, KOL-4715 (all Done) |

**Current HEAD at handoff: `4929d76` on `main`.** Local, origin and NAS were all
in sync at that commit.

---

## 2. Dev loop — do not deviate

1. **Edit in `C:\dev\nitro`.** Vite *cannot* run from the NAS copy — a mapped-drive
   → UNC bug serves raw TypeScript and breaks the build. The NAS copy is a mirror
   for Kol, not a workspace.
2. `npx tsc --noEmit` then `npm run build` — both must exit 0.
3. `git commit` + `git push origin main` → GitHub Actions auto-deploys to Pages.
   Check with `gh run list --limit 1`.
4. `git pull --ff-only origin main` in the NAS copy to mirror.
5. Preview server: launch config `nitro-local`, port 5188.

### NAS gotcha
`git` on `W:\` intermittently times out and can leave `.git/index.lock` behind
with a **torn checkout** (files deleted, HEAD stale). Recovery that worked:
```bash
rm .git/index.lock
git fetch origin
git reset --hard origin/main
```
Origin is canonical; never treat the NAS copy as the source of truth.

---

## 3. Hard-won traps (each of these cost real time)

**Never use PowerShell 5.1 `Get-Content`/`Set-Content` on source files.** It reads
as ANSI and writes UTF-8, double-encoding em-dashes into `â€"` mojibake. It
corrupted `race.ts` and `audio.ts` mid-session and one bad file got committed.
Use an editor tool, or Python/Node for byte-precise edits. To check the tree:
```bash
grep -rl $'\xc3\xa2\xe2\x82\xac' src/   # finds double-encoded em-dashes
```

**`requestAnimationFrame` never fires in the preview tab** — it runs hidden. Any
rAF-based probe collects zero samples. Drive frames manually instead:
`window.__nitro.tick(dt, skipRender)`.

**The preview canvas resets to 0×0 on navigation.** Always resize the viewport to
e.g. 1280×720 *after* every reload, or `canvas.toDataURL()` returns the literal
string `"data:,"` and screenshots silently fail.

**Benchmark synchronously with `gl.finish()`**, warmed, min-of-3 — single cold
runs are noisy enough to invert the quality-tier ordering:
```js
const gl = __nitro.debug.renderer.getContext();
const once = () => { for (let i=0;i<10;i++) __nitro.tick(1/60,false); gl.finish();
  const t0=performance.now(); for (let i=0;i<40;i++) __nitro.tick(1/60,false); gl.finish();
  return (performance.now()-t0)/40; };
once(); once(); Math.min(once(), once(), once());
```

**A fresh profile shows the tutorial**, which sets `tutorialActive` and *blocks*
`race.update()` — headless sims then sit in `countdown` forever and look like a
physics bug. Always set `__nitro.tutorialActive = false`.

**The countdown is 3.4 s (~204 frames).** Synthetic input before that does nothing.

**`?perf` disables `renderer.info.autoReset`** — call `info.reset()` before any
manual draw-call measurement or counts accumulate.

**Film grain makes frames non-deterministic.** Any pixel-diff test must run at
`quality='low'`. This is how an earlier session wrongly concluded the sky dome
was visible.

**`setTargetAtTime` does not change `.value` synchronously.** Reading a Web Audio
param or a `gain.value` straight after scheduling tells you nothing — assert on
your own state variables instead.

**Private TS fields are all reachable at runtime** (`__nitro.profile`,
`__nitro.debug.race`, `__nitro.photoTilt`, `race.weather`) — invaluable for
harnesses, and the reason most verification here is a `javascript_tool` call.

---

## 4. Architecture map

```
src/
  main.ts            bootstrap, state machine, camera rig, post-FX composer,
                     race lifecycle, photo mode, ?perf, ?goto
  game/
    data.ts          CARS(12) LIVERIES(7) TRACKS(12) CUPS(3) themes+lighting+grade+env
    track.ts         procedural track build, terrain, scatter, landforms, dressing,
                     wind shader injection, trackCache
    race.ts          simulation, AI, weapons, modes, weather, effects, dispose
    models.ts        GLB load/cache, instancing helpers, wheel rig
    carmesh.ts       procedural car + car lights (headlight pools, tail/brake)
    post.ts          GradeShader (split-tone/exposure/haze/vignette), TiltShiftShader
    audio.ts         buses, harmonic engine, screech, procedural music
    save.ts          profile schema v3, ghosts, leaderboards, difficulty tuning
  ui/
    screens.ts       all front-end screens + MiniStage usage
    hud.ts           in-race HUD, minimap
    ministage.ts     single extra WebGL context (garage turntable, podium)
docs/
  2026-06-18-scale-10-plan.md   original 5-phase plan + status board
  gauntlet-loop.md              critic protocol, iteration log, lessons
  HANDOFF-CODEX.md              this file
```

---

## 5. State: what is built

**Phases 1–5 of the scale-10 plan are complete** (see `docs/2026-06-18-scale-10-plan.md`):

- **P1 perf** — instanced foliage/rocks, rebuilt mountain pass, track caching.
  Tunnel draw calls ~400–800 → 66.
- **P2 graphics** — sky dome, `FogExp2`, flat shading, GTAO/bloom/grade/grain/SMAA,
  rim light, per-theme lighting rigs, nocturnal night.
- **P3 juice** — wheel spin/steer/suspension, boost trail, HUD pops, garage
  turntable, podium. Skid marks instanced (150 → 0 extra draw calls).
- **P4 content** — 12 cars, 12 tracks, 3 progression-gated cups, Time Trial with
  ghosts + top-5 leaderboards, Elimination, 7 liveries, difficulty.
- **P5 audio/UX** — engine/SFX/music buses, tyre screech, photo mode, soft-lock audit.

**Gauntlet iterations 1–5** (visual quality push, `docs/gauntlet-loop.md`):

- Terrain relief (2-octave), clustered verge scatter, landform silhouettes
  (hills/dunes/drifts/night-city with emissive windows).
- Road: embankment, edge shadow, wear bands, racing line, grime.
- Trackside dressing: sponsor billboards (raked 32°), crowds behind **solid**
  barriers, checkered start gantry.
- Cinematic grade: split-tone, per-theme exposure, screen-space aerial haze,
  hue-safe multiplicative vignette, tilt-shift.
- Night identity: neon unlit kerbs, headlight ground pools, tail/brake lamps,
  lit bridge rails.
- **Perspective camera** (see §6 — the big one).
- **Engine audio rebuild**: 5-order harmonic stack, resonant load-tracking filter,
  RPM that sweeps within each gear and drops on the shift.
- **Dynamic weather**: clear/rain/storm, wet roads, spray, lightning, grip loss.
- **GPU wind** on all vegetation.

---

## 6. The single most important thing to understand

For four gauntlet iterations the game was judged "flat / board game on a table /
2019" and no amount of art fixed it. **The cause was the camera: an
`OrthographicCamera` at a near-vertical 65°.** Orthographic projection is flat by
definition — no foreshortening, no parallax — and at that angle you only ever saw
the *tops* of objects, so every silhouette built (billboards, crowds, towers,
gantry) was invisible by construction.

Kol diagnosed it in one sentence; five rounds of automated art critique never
questioned the geometry. It is now a `PerspectiveCamera`, fov 34, tilt 46° above
horizontal, distance solved from framing height so the `zoom` setting keeps its
meaning, with speed pullback and heading lead.

**Standing rule for any future critique loop: always ask whether projection,
camera or framing is preventing the scene from reading — before touching art.**

---

## 7. Invariants — do not "tidy" these away

1. **The track group is cached and shared across races** (`trackCache` in
   `track.ts`). `Race.dispose()` *detaches* it, never disposes it. Anything that
   mutates a track material at race time **must** stash originals and restore them
   in `dispose()` — the wet-weather pass does exactly this.
2. `obstacles` is copied per-race; the tanker wreck and barriers push into the
   copy, never the cached array.
3. `fxGeo` and the skid `InstancedMesh` are **race-owned**, not module-level — a
   module constant would be disposed out from under race #2.
4. Car and wheel rotation order is **`YXZ`** — required for car-local pitch/lean
   and steered-axle spin.
5. **Only one `MiniStage` may live at a time**; `Screens.clear()` is the single
   disposal choke point and calls `forceContextLoss()`. Browsers cap ~16 WebGL
   contexts and silently blank the oldest — which would kill the main canvas.
6. Camera `far` is 3000 (sky dome radius 1200).
7. Terrain relief is masked flat inside the racing corridor — the sim is 2D and
   cars run at `y=0`. Verify `player.pos.y === 0` after any terrain change.
8. `Settings.quality` gates GTAO + SMAA (high) and the grade/tilt/vignette/grain
   group (medium+). Keep the gating.

---

## 8. Bugs already found and fixed — don't reintroduce

- **three's `VignetteShader` hue-shifts dark scenes.** Its `darkness > 1` mixes
  toward a negative constant, turning navy corners olive. Replaced by a
  multiplicative vignette inside `GradeShader`. Don't switch back.
- **The `RoomEnvironment` studio probe floods terrain with white IBL.** It is
  there for car paint. Track materials are pinned to `envMapIntensity = 0.18` at
  the end of `buildTrack`. This is why snow read as a white void for two
  iterations, and why wet roads must **not** get a big `envMapIntensity` boost.
- **Luma-normalised grade tints amplify chroma** of saturated dark colours (night
  `0x101830` became a ×2 blue multiplier). Tints now lerp 45% toward white.
- **Crash-loop soft-lock (shipped for weeks):** the tanker wreck (radius 3.4)
  spawns across the racing line and crash-recovery respawned cars at track centre
  — still inside it. Fixed by `clearRespawn()` (searches forward for an
  obstacle-free spot) plus AI lateral avoidance of obstacles.
- **Effect churn:** dust/spark puffs used to allocate geometry *and* material per
  puff. They now share `fxGeo` and dispose their material on expiry.

---

## 9. Performance baselines (measure against these)

In-tunnel, Forest Run, 1280×720, HIGH quality, warmed, min-of-3, `gl.finish()`:

| State | ms/frame |
|---|---|
| Budget (60 fps) | 16.7 |
| Current (clear) | **2.84** |
| Current (storm) | 4.34 |
| Scene draw calls | ~112 |

Bundle: ~815 kB single chunk (three.js not code-split). Known debt; fine for now,
worth `manualChunks` before any real launch.

---

## 10. Verification recipes (copy-paste)

**Soft-lock sweep — run after ANY change to AI, physics, obstacles or track gen.**
This is the most important gate in the project:
```js
// in the preview console, after resizing the viewport
const bust = '?v=' + Date.now();
const data = await import('/src/game/data.ts' + bust);
const trackMod = await import('/src/game/track.ts' + bust);
const raceMod = await import('/src/game/race.ts' + bust);
const models = await import('/src/game/models.ts' + bust);
await models.ensureModelsLoaded();
const NO = {throttle:false,brake:false,left:false,right:false,steerAxis:null,boost:false,fireMissile:false,dropMine:false};
const mk = () => { const c=[{id:'player',name:'YOU',carNum:'47',color:0xd62828,accent:0xffffff,
  model:models.PLAYER_CAR_MODELS['rival-x']??null,isPlayer:true,skill:1,
  stats:{speed:6,accel:6,handling:6,armour:6,boost:6},condition:100,items:{missile:0,mine:0}}];
  for (const r of data.RIVALS) c.push({id:r.id,name:r.name,carNum:r.carNum,color:r.color,accent:r.accent,
    model:models.RIVAL_MODELS[r.id]??null,isPlayer:false,skill:r.skill,
    stats:{speed:6,accel:6,handling:6,armour:6,boost:6},condition:100,items:{missile:0,mine:0}});
  return c; };
const bad = [];
for (const def of data.TRACKS) {
  const track = trackMod.buildTrack(def);
  const race = new raceMod.Race(track, mk(), ()=>{}, ()=>{}, { weapons:false });
  race.autopilot = true;
  for (let i=0;i<1500;i++) race.update(1/60, NO, false);
  const mid = race.racers.map(r=>r.progress);
  for (let i=0;i<1500;i++) race.update(1/60, NO, false);
  const adv = race.racers.map((r,i)=>(r.progress-mid[i])*track.totalLength);
  if (Math.min(...adv) < 120) bad.push(def.id);
  race.dispose();
}
bad;   // MUST be []
```
Progress is measured in **metres covered in the second 25 s window** — not laps.
Lap-progress varies with track length and will give false failures.

**Deterministic screenshots:** `?goto=garage|settings|modes|leaderboards|tournament`
jumps straight to a front-end screen. In-race, drive headless then POST the canvas
to the dev sink:
```js
await fetch('/__shot?name=foo', { method:'POST',
  body: document.getElementById('game-canvas').toDataURL('image/jpeg', 0.92) });
// lands in C:\dev\nitro\shots\foo.jpg
```

---

## 11. The critic loop, and its known flaws

`docs/gauntlet-loop.md` holds the protocol. Read it before running a critique
round. Summary of what was learned the hard way:

- Fresh-context LLM art critics **saturated at ~3.5/10** across four rounds while
  the frames transformed, and round 4 recommended five fixes of which **four were
  already implemented and visible**.
- Causes: (a) critics see downscaled images, so 2–6 px effects don't register —
  "too subtle to see at model resolution" reads as *absent*; (b) pixel-density
  anchoring — a top-down game's 40 px cars can't match a chase-cam reference's
  600 px hero car for detail-per-pixel, pinning the score floor.
- Inter-critic variance is **±0.5–1.0**. Only act on findings that repeat across
  two rounds.
- **A counter-review (Kimi K3, 2026-08-11) flagged two real defects in Protocol v2
  and they are NOT yet fixed:** (1) handing critics the implemented-systems list
  primes sycophantic confirmation — separate *progression* scoring from
  *absolute-bar* scoring and seed unlabeled decoy frames from old iterations;
  (2) the v2 exit condition is broken as written — "indistinguishable ≥ half the
  time" passes on coin-flips, and 42-cell ≥9 unanimity over two rounds is
  unreachable at ±0.5–1.0 noise. Use **mean ≥9 with no axis below 8, across a
  panel**. Fixing this is a live task.
- Reference stills live **outside the repo** at `C:\dev\nitro-refs\` (copyrighted
  press material — never commit them). Re-fetch from the *art of rally* press kit
  if missing.

---

## 12. Outstanding work

### Blocked on Kol — cannot proceed without him
| Item | Blocker |
|---|---|
| Real 3D car/prop/terrain models | **Blender is not running.** MCP is registered but nothing listens on `localhost:9876`. Needs Blender open with the MCP addon enabled and its server started. |
| — alternative | Buy a pro low-poly pack (Synty / Quaternius / KayKit). Costs money → Kol's decision. |
| Real SFX + music | ElevenLabs API key lacks the `sound_generation` scope (and `user_read`). TTS scope works — that's why the voice lines exist. Verified failing 2026-08-11. |
| Menu/garage key art | Magnific + Runway MCPs need OAuth authorisation. |
| Does audio actually play on Kol's machine? | Never confirmed on his hardware. |
| Default `quality` tier | Currently `high`. A weak iGPU may miss 60 fps on first run. Options: keep / default `medium` / auto-detect. |

### Not blocked — ranked by value
1. **Replay + cinematic director.** Every race recorded, played back with
   auto-directed camera cuts, exportable clip. The ghost-recording data layer
   (`GhostLap` in `save.ts`, recorder in `race.ts`) already exists, and photo mode
   proves the free-camera rig. Kol rates this the "makes people talk" feature.
2. **Vegetation + world assets for the new camera.** Trees were authored to be
   seen from above and read as lollipops in perspective; verge scatter is cones.
   This is now the most visible weakness.
3. **Time-of-day variation** — dawn/noon/dusk within a theme, not just the NIGHT
   theme. Lighting rigs are already per-theme data, so this is mostly interpolation.
4. **Fix the critic exit condition** per §11.
5. **Bundle code-split** (`manualChunks` for three.js).
6. **Livery painter** and **track editor + seed sharing** — both build on systems
   that already exist (liveries shipped; the track generator is seeded).

### A recorded negative result — don't redo it
A procedural car was built from an extruded side profile (clearcoat paint,
transmissive glass, tyre + spoked rims, emissive lamps). Measured side-by-side
under the perspective camera it **reads as a loaf at gameplay scale and loses to
the hand-authored Kenney GLBs.** GLB models remain primary; the procedural car is
the improved fallback in `carmesh.ts`. Authoring car geometry in TypeScript has a
real ceiling — realistic cars need Blender or a bought pack.

---

## 13. Conventions

- Track work in Linear: **KOL-4818**, parent **KOL-4160**.
- Never publish, deploy outside the existing CI flow, spend money, change DNS or
  auth, or post externally without Kol's explicit approval.
- Public repo: commit only CC0 (Kenney) or generated assets. No press material.
- Save schema is localStorage `nitro-circuit-overdrive-save-v3`. Bump the key on
  any breaking schema change; new fields merge safely via `loadProfile()`.
- Kol wants continuous work with few check-ins. Report at genuine milestones or
  genuine blockers, not every step.
