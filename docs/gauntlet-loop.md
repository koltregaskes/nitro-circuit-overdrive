# GAUNTLET LOOP — Nitro Circuit Overdrive → 10/10

This is the operating self-prompt for the quality gauntlet. It follows the Shumer
Gauntlet Loop structure and the technique used in Kol's HOMEWORLD CLONE sessions:
a concrete visual bar, separated builder/critic roles, blind A/B judgement, and
no arbitrary stopping point. Kol's verdict on the current game: **1/10. The only
acceptable exit is 10/10.**

## The bar

**art of rally** (funselektor). Real stills of it are the reference set, stored
OUTSIDE this public repo in `C:\dev\nitro-refs\` (copyrighted press material —
never commit it). Our fixed shot list is compared against those stills blind.
Secondary feel bar: Horizon Chase Turbo / Hotshot Racing for readability and UI.

## Roles

- **Orchestrator (this session, Fable):** runs the loop, plans, verifies, never
  self-grades. Per Kol's standing directive, Fable plans/verifies; builder
  fan-outs use Sonnet/Opus subagents.
- **Builders:** implement fixes for the ranked gap list. Independent lanes may
  run as parallel subagents (terrain/environment · lighting/grade · UI/HUD ·
  assets via Blender MCP).
- **Critic (fresh-context subagent, every iteration):** shown our shots and the
  reference stills. Brutal by instruction. Scores each axis 1–10, names the
  single biggest gap per shot, and does a blind pick ("which of these two frames
  is from the professional game?"). The critic never sees the code, only frames.

## Scoring axes

1. Art direction & composition (does the frame look *designed*?)
2. Terrain & environment (relief, density, variety, horizon interest)
3. Lighting & atmosphere (sun direction you can feel, colour harmony, depth)
4. Materials & shading (surface interest without noise)
5. Track & road presentation (surface, edges, markings, wear)
6. UI/HUD & front-end (typography, layout, restraint)
7. Cohesion (does everything belong to one world?)

## Fixed shot list (deterministic, re-captured every iteration)

- S1 forest race, mid-corner with pack visible
- S2 desert race
- S3 snow race
- S4 night race
- S5 main menu
- S6 garage

Capture via the dev `/__shot` sink at 1280×720, HIGH quality tier.

## Loop protocol

1. Capture the shot list from the live build.
2. Critic scores + ranks gaps + blind A/B against the reference set.
3. Orchestrator turns the verdict into a ranked fix list; builders execute the
   top items (batch related fixes; prefer systemic fixes over spot fixes).
4. Hard gates before the next iteration: `tsc` + build clean · 60 fps budget
   (≤10 ms/frame HIGH in-tunnel, measured with gl.finish, warmed min-of-3) ·
   headless 12-track soft-lock sweep still 0 · deploy only via the normal
   push→CI flow.
5. Re-capture. Repeat. **Do not stop at an iteration count; stop at the bar.**

## Exit condition

Critic gives ≥9 on every axis for every shot, AND in blind A/B our frame is
picked or judged indistinguishable at least half the time, over two consecutive
iterations. Kol is the final judge above the critic.

## Constraints

- Stay a Three.js web game (no engine port — Unreal/Unity/Blender are asset and
  reference tools, not the runtime).
- Public repo: only CC0 (Kenney) or generated assets get committed.
- Never regress: the Phase 1–5 invariants in `2026-06-18-scale-10-plan.md` hold
  (cached track group, race-owned fx resources, YXZ rotation order, one
  MiniStage, camera far=2200, no PS5.1 Get/Set-Content on source files).
- Magnific/Runway remain OAuth-gated; ElevenLabs scopes to be re-tested before
  audio iterations. Do not block visual iterations on audio.

## Log

| Iter | Date | Critic verdict (worst axis) | Action taken |
|---|---|---|---|
| 0 | 2026-08-08 | **3.0/10 overall vs 8.5/10 ref** ("REWORK — no art direction applied"; worst axes: terrain/environment 2, lighting 2) | Ranked top-8 received. Iteration 1 lanes: (A) terrain relief + shoulder scatter + landforms + road edges [track.ts], (B) cinematic grade + tilt-shift diorama pass [post.ts/main.ts], (C) night car lights — headlight pools, tail/brake lamps [carmesh/models/race]. Palette harmony retune landed in data.ts. |
| 1 | 2026-08-08 | orchestrator gate (no critic): grade over-hot (luma-normalised tints ×2 chroma), tufts = dark X-specks, vignette hue-shifts navy→olive (bug since Phase 2) | Tint chroma mix 0.35; tufts → lit cones, clustered hero/mass; multiplicative vignette inside GradeShader (three's VignetteShader dropped); GLB foliage tint hook (desert palms). |
| 2 | 2026-08-09 | **4.0/10** (critic 2: "lit like a product turntable"; sun too high, value range compressed, snow fog-broken, emissives too timid) | 22° raking sun + warm/cool rigs, 2048 shadow map; grade punch restored; night kerbs unlit-neon; snow rescue: terrain envMapIntensity 0.18 (IBL flood), per-theme exposure uniform, dark pine punctuation. |
| 3 | 2026-08-09 | **3.5/10** (critic 3 — variance vs critic 2; consistent findings: AO discs = casterless blobs, ghost-smear shadows, flat beam cutouts, no aerial perspective possible in ortho) | Sun raised to ~31° (shadow length sane); AO discs centred/faded; beams 0.5 opacity; screen-space vertical aerial haze in grade (ortho-correct substitute); terrain detail speckle map; night bridge dark deck + lit rails; palm tint 0.75. Perf 4.07 ms HIGH. |

**Observed inter-critic variance is ±0.5–1.0** — single-round scores are noisy; trust
only findings that repeat across rounds, and require the exit bar over two
consecutive rounds (already in the protocol).
