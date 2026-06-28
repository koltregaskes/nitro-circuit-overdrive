# Nitro Circuit Overdrive — Session Handoff

> **Read this first.** It is self-contained: a fresh session with zero prior chat context
> can continue from here. Last updated after **Phase 1** of the "scale 1 → 10" plan.

## What this is

**Nitro Circuit Overdrive** — an original 2.5D top-down / near-isometric arcade racer
(TypeScript + Vite + Three.js, all-procedural + Kenney CC0 low-poly models). Cups,
garage upgrades, AI rivals, weapons, live events. Visual/feel target = **art of rally**
(flat-shaded low-poly, gradient sky, atmospheric fog, dust, photo mode) + **Super Cars**
gameplay DNA. Orthographic top-down camera (never a chase cam).

Linear issue: **KOL-4160**. Live game: **https://koltregaskes.github.io/nitro-circuit-overdrive/**

## Where the project lives (IMPORTANT — read carefully)

- **Canonical source of truth: the GitHub repo** `github.com/koltregaskes/nitro-circuit-overdrive`
  (public). CI auto-deploys `main` → GitHub Pages on every push.
- **Kol's copy: `W:\200-build-room\Projects\nitro-circuit-overdrive`** (the NAS workspace).
  Keep this in sync (`git pull`). This is the "home" of the project.
- **`C:\dev\nitro` is a DISPOSABLE local dev clone — not where the project "lives".**
  It exists ONLY because **Vite cannot run on the NAS** (the mapped-drive→UNC path bug
  makes Vite serve raw, untransformed TypeScript, so the game never boots in the dev
  server and the build fails with doubled paths). Running/verifying the game requires a
  local (non-NAS) clone. If you prefer a different local path, re-clone anywhere on `C:`
  and update the `nitro-local` launch config — it's throwaway.

### The dev loop (do not deviate)
1. Edit in the **local clone** (`C:\dev\nitro`).
2. `npm run build` works locally there (tsc + vite). Type-check with `npx tsc --noEmit`.
3. `git commit` + `git push` from the clone → CI builds + deploys to Pages.
4. `git pull` the NAS copy (`W:\200-build-room\Projects\nitro-circuit-overdrive`) to keep it current.
5. **Visual verify** via the preview tool, launch config **`nitro-local`** (port **5188**,
   defined in `W:\.claude\launch.json`, runs `npm run dev --prefix C:\dev\nitro`):
   - ALWAYS `preview_resize` to a real size (e.g. 1280×720) FIRST — the preview viewport
     defaults to 0×0, which blocks the WebGL boot (`window.__nitro` stays undefined).
   - `preview_screenshot` sometimes hangs. Reliable alternative: in `preview_eval`, draw
     the canvas to a temp canvas and POST its dataURL to the dev `/__shot?name=x` endpoint
     (a Vite plugin in `vite.config.ts`), then `Read` the JPG from `C:\dev\nitro\shots\`.
   - **Headless sim:** `window.__nitro.debug` = `{ state, race, profile, renderer, tick(dt, skipRender) }`.
     Set `race.autopilot = true` and call `tick(1/60, true)` in a loop to drive races with
     no input. Measure draw calls with a DIRECT render (the EffectComposer resets
     `renderer.info` on its final pass): `game.camera` is live at runtime — do
     `d.renderer.render(d.race.scene, window.__nitro.camera)` then read `d.renderer.info.render.calls`.

### Git/NAS shell gotchas (Windows)
- The `W:` drive mapping drops between sessions: `net use W: \\nas_storage_1\Workspaces /persistent:no` before `Set-Location W:`.
- `cmd.exe`/`npm` cannot use a UNC working dir — always run npm from `C:\dev\nitro` or the mapped `W:`.
- PowerShell here-string commit messages are flaky — use multiple `-m` flags instead.

## Asset generation (no MCPs needed — call APIs directly)
Keys are in `\\nas_storage_1\Workspaces\.env`:
- **Images: Hugging Face FLUX.** `HUGGINGFACE_API_KEY` (hf_…). POST `{inputs:"<prompt>"}` to
  `https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell`
  (the old `api-inference.huggingface.co` host is dead; FLUX.1-dev returns 410). Save the
  binary as PNG into `public/ui/`. Current UI art: `menu-bg.png`, `garage-bg.png`, `cup-bg.png`.
- **Voice: ElevenLabs TTS only.** `ELEVENLABS_API_KEY` (sk_…). POST to
  `https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb`, header `xi-api-key`,
  `{text, model_id:"eleven_multilingual_v2"}` → mp3 into `public/audio/`. The key LACKS
  `sound_generation` scope (SFX/music API → 401); use procedural WebAudio for those.
- **GPT Image / Gemini: NOT available** — `OPENAI_API_KEY` and `GEMINI_API_KEY` are EMPTY in `.env`.
- Reference assets via `import.meta.env.BASE_URL` (Pages serves under `/nitro-circuit-overdrive/`).
- Magnific / ElevenLabs / Runway MCPs never attach in this environment — don't wait on them.

## Current state — Phase 1 COMPLETE (committed `1c8cbfd`, deployed)

The plan is `docs/2026-06-18-scale-10-plan.md`. Order is **perf → graphics → animation →
content → polish**, target **art of rally**, scope **full roadmap**.

**Phase 1 (race-start hitch & draw calls) — DONE & VERIFIED:**
- Instanced foliage/rocks: `getInstanceParts()` in `src/game/models.ts` bakes each model to
  normalised geometry + shared material (cached); `addDecor()` in `src/game/track.ts` buckets
  ~140 props → one `InstancedMesh` per model (14 total). Cars/debris still use `rawClone`.
- Mountain pass rewritten (`buildMountainPass` in `src/game/track.ts`): ~1,000 meshes → ~7
  (merged wall strips via `wallStrip()`, 2 instanced rock meshes, merged portal arches).
- Trackside flags merged into 2 meshes (`mergeGeometries`).
- Track caching (`trackCache` in `src/game/track.ts`): built tracks are deterministic +
  immutable, cached by `id:seed`. `Race.dispose()` (`src/game/race.ts`) now DETACHES the
  cached group (`scene.remove`) instead of disposing it, so replays reuse it. `Race` holds a
  race-local **copy** of `obstacles` (the tanker wreck pushes to the copy, not the cached track).
- Async start: GLBs preloaded at `Game` construction; a `setTimeout(32)` yield lets the
  LOADING screen paint before the build (NOT rAF — throttled when unfocused).
- **Result: tunnel-track draw calls ~400–800 → 66** (verified headless on Forest Run).
  Cached replay (pause→restart) renders identically (66 calls, 45,708 tris, 14 instanced).
- `window.__nitro.debug.renderer` was exposed for measurement (harmless; keep).

**Verified working:** tsc clean, local build clean, screenshots `shots/phase1-forest.jpg` +
`shots/phase1-restart.jpg` correct. NOT yet hammered: a full 6-race cup end-to-end on every
theme (do a headless `autopilot` pass over all tracks to confirm no soft-lock).

## Next — Phases 2–5 (see the plan doc for file:line detail)

- **Phase 2 (graphics → art of rally):** gradient **sky dome** (replace `makeSkyGradient` flat
  bg in `race.ts`), `FogExp2`, **flat shading** everywhere, post stack in `setupComposer`
  (`main.ts`): `GTAOPass` (contact AO) + `VignetteShader` + `HueSaturationShader` (per-theme
  grade) + `FilmPass` (grain) + `SMAAPass`, quality-gated; rim light; per-theme palettes + a
  nocturnal NIGHT theme. **Highest-impact remaining work.**
- **Phase 3 (juice):** wheel spin/steer/suspension squash (`stepRacer` in `race.ts`,
  collect `/wheel/i` meshes like the `/body/i` tint in `models.ts`); boost trail; CSS
  countdown/lap pops; garage car turntable; podium sequence.
- **Phase 4 (content, full roadmap):** procedural varied tracks (VALIDATE each with headless
  autopilot laps — the AI line + lap detection assume convex-ish loops); more cars; Time
  Trial + ghost + local leaderboards; Elimination; difficulty; more cups + liveries.
- **Phase 5 (polish):** audio buses + real engine/music; photo mode (`BokehPass`); settings
  depth (quality/difficulty/keybinds); soft-lock audit.

### Top risks to remember
1. Track cache vs `dispose()` — never dispose the cached track group (already guarded via
   `scene.remove` + `userData.cached`). Test replays after any dispose change.
2. `obstacles` is a race-local copy — keep it that way or the tanker/pillars leak across races.
3. Procedural tracks (Phase 4) must be headless-validated before shipping.
4. Post-FX stack (Phase 2) is 5 full-screen passes — quality-gate GTAO/SMAA.

## Working conventions for Kol
- Track all work in **Linear** (issue KOL-4160; Linear MCP `mcp__f320423f-…__*`).
- End game-session replies with the play link: `https://koltregaskes.github.io/nitro-circuit-overdrive/`.
- Reply structure: last-change line → Linear-keyed status table → TLDR; keep prose short.
- Save data is `localStorage` key `…-save-v2`; bump the version if the save schema changes.
