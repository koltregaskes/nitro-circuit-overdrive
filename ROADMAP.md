# Nitro Circuit Overdrive — Road to Launch

Honest status: this is a **strong, complete vertical slice** ("~3–4 stars"), not yet
a shippable commercial game ("10 stars"). This doc maps the gap, grounded in what
the best games in the genre actually ship.

## Genre benchmarks (what "good" looks like)

| Game | Content | What it nails |
|---|---|---|
| **Horizon Chase Turbo** | 12 cups · 48 cities · **109 tracks** · 31 cars · 12 upgrades · 4 modes (World Tour, Tournament, Endurance, Playground) | Volume of content, token-gated progression, instant pick-up-and-play, '90s arcade joy |
| **Hotshot Racing** | 8 cars · 16 tracks · 4 modes incl. Cops & Robbers, Drive-or-Explode | Chunky low-poly style, *tight drift+boost loop*, bright readable tracks, 4-player |
| **art of rally** | 60+ stages · 70s–90s career · leaderboards · photo mode | Minimalist top-down beauty, atmosphere, online leaderboards, replay/photo |

**Takeaways for us:** (1) content volume is the #1 gap; (2) the drift→boost→overtake
loop must feel *great*; (3) art direction + audio carry the "quality" perception;
(4) extra modes (Time Trial + leaderboards, Elimination) massively extend playtime.

## Where we are today

- 1 cup, **6 tracks** (4 themes), 6 cars, 4×5 upgrades, weapons, live events
  (animal crossing, animated tanker crash), oil slicks, tunnels-through-mountains,
  object collisions w/ crash+respawn, gamepad, responsive UI, saves.
- Kenney CC0 low-poly models, real-time shadows + bloom, procedural textures,
  screen shake, skid marks, dust. Procedural WebAudio SFX (no music yet).
- Live + auto-deployed: https://koltregaskes.github.io/nitro-circuit-overdrive/

## The plan to "10 stars"

### 1. Art & audio (needs Magnific + ElevenLabs MCPs — biggest quality lever)
- [ ] Magnific: menu/garage background art, per-theme skyboxes, ground/road texture maps, car-select splash art, cup emblems, loading art.
- [ ] ElevenLabs: real engine loop (per-tier), tyre screech, impact/explosion/boost SFX, UI clicks, announcer ("3-2-1-GO", "Final Lap"), **menu + race music** per theme.
- [ ] Replace all procedural WebAudio with mixed, ducked audio (engine under SFX under music).

### 2. Content volume (the genre's table stakes)
- [ ] 3–4 cups (Rookie → Street → Hazard → Overdrive), ~16–24 tracks total, gated by stars/cash.
- [ ] 10–12 cars across 5 tiers with distinct silhouettes + handling identities.
- [ ] Liveries / paint unlocks; per-car upgrade trees.

### 3. Game modes (extend playtime)
- [ ] **Time Trial** + ghost car + local leaderboard (localStorage).
- [ ] **Elimination/Endurance** (last place culled each lap).
- [ ] Quick Race / free play with options.

### 4. Feel & polish
- [ ] Tune drift+boost loop to Hotshot-tightness; difficulty selector (Easy/Normal/Hard).
- [ ] Rival AI personalities (aggressive/clean/rubber-band), per-rival garage builds.
- [ ] Pre-race grid intro cam, podium/celebration sequence, replay cam.
- [ ] Minimap polish, position-change toasts, combo/near-miss scoring.

### 5. Launch readiness
- [ ] Settings: keybind remap, resolution/quality, audio mixer, colour-blind options.
- [ ] Pause-safe everything, no soft-locks; analytics-free, GDPR-clean.
- [ ] Itch.io / Steam page, trailer (HyperFrames), screenshots, store copy.
- [ ] Code-split the 660 kB bundle; loading screen with progress; perf pass for low-end.
- [ ] Playtest cycle + balance pass; achievements.

## Known issues / tech debt
- Single JS chunk > 500 kB (three.js not code-split) — fine for slice, fix pre-launch.
- AI doesn't avoid mines/oil/obstacles; rivals are stat-scaled, not per-car builds.
- Audio unverified on the player's machine (confirm before investing in mix).
- No online anything (by design for the slice; out of scope unless desired).

## Done in code review (this pass)
- Fixed shared-geometry/material disposal: cloned GLB models now own their assets,
  so a race's `dispose()` no longer frees cached source assets (stability/perf).
- Removed dead `buildWall` (superseded by the mountain pass).
- Added screen shake, skid marks, dust; +3 cars, +2 tracks, cup expanded to 6 races.
