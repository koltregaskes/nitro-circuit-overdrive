# Nitro Circuit Overdrive

**▶ Play now: https://koltregaskes.github.io/nitro-circuit-overdrive/**

A 2.5D top-down / near-isometric arcade racer. Original game — no copyrighted
assets (3D models are Kenney CC0). TypeScript + Vite + Three.js. Auto-deploys to
GitHub Pages on every push to `main`.

Inspired by the *feel* of art-of-rally-style readable top-down racing and the
competition DNA of classic top-down racers: cups, standings, garage upgrades,
repairs, light weapons, AI rivals.

![race](shots/race-start.jpg)

## Run

```bash
npm install
npm run dev        # dev server (vite) — open the printed localhost URL
```

> Note: the project lives on a NAS share. `npm install` must run from the mapped
> drive (`W:\...`), not the raw UNC path — esbuild's installer spawns cmd.exe which
> can't use UNC working directories. `vite.config.ts` uses polling file-watch
> because SMB shares don't support native `fs.watch`.

## Build

```bash
npm run build      # tsc --noEmit && vite build  -> dist/
npm run preview    # serve the production build
```

## Controls

Keyboard and a standard gamepad (Xbox layout) both drive. The menu footer lists the same bindings.

| Keyboard | Gamepad | Action |
|---|---|---|
| `W` / Up | RT or A | throttle |
| `S` / Down | LT or B | brake |
| `A` / Left, `D` / Right | left stick | steer |
| Left Shift | X | boost (meter drains, regenerates) |
| `F` | RB | front missile (homing, hits the first racer ahead) |
| `E` | LB | drop a mine behind |
| Esc | Start | pause (resume / restart / forfeit) |

`P` during a race freezes the sim for a photo. In photo mode, WASD pans, Q/E zoom, Z/X tilt, R recentres, Esc returns to the race.

## Career

Three cups, twelve tracks, twelve garage cars. Finish the cup you are in — the standings screen names a champion or your place — then the next unlocked cup, or race the same cup again. Cash, cars, and upgrades carry over. Street Cup opens after $40,000 total prize money; Overdrive Cup 2026 opens after $140,000.

| Cup | Races | Points | Champion bonus |
|---|---|---|---|
| **Rookie Cup** (open) | Sunset Mile, Dockyard Dash, Dune Sweep, Forest Run | 10/8/6/4/2/1 | $15,000 |
| **Street Cup** | Canyon Run, Midnight Mall, Glacier Gate, Pine Hairpins, Neon Boulevard | 10/8/6/4/2/1 | $25,000 |
| **Overdrive Cup 2026** | Icebreaker, Frostbite Loop, Canyon Run, Pine Hairpins, Neon Boulevard, Grand Overdrive | 12/9/7/5/3/1 | $50,000 |

- **Camera:** perspective top-down, about 46° above the horizon. It stays readable and never drops into a bumper chase cam. Zoom is in settings.
- **12 tracks** across desert, forest, snow, and night. Lap counts run from 4 to 7.
- **6 cars per race:** you plus five named AI rivals with distinct skill, corner-speed awareness, rubber-banding, and item/boost use.
- **Arcade handling:** forgiving grip with drift slip, optional steering assist, grass slowdown, soft outer boundaries (no hard walls, no insta-death).
- **Weapons & damage:** boost meter, homing front missiles, proximity mines, armour, spin-outs. A wreck is a brief stun plus partial auto-repair. A fast door-to-door pass scores a near miss and adds $200 to the prize. Damage persists as car condition; repair it in the garage.
- **Garage:** four upgrade lines × five levels (engine, handling, armour, boost), missile and mine purchases, full repair, liveries, and twelve cars. Rival-X is the starter. Kolt-47, Vex-77, Hex-9, Nitrous, and Ghost use Kenney bodies. Ghost shares the future-race body with Vex-77, and the garage says so. Cab-12, Hauler, Courier, Enforcer, Drifter, and Apex have no model of their own — they share the stock chassis, and each card is labeled with that car's name plus "shared stock chassis".
- **Tournament:** prize money by finish, live cup standings, a champion bonus, and a restart from race 1 that keeps your money and cars. The in-race HUD names the cup you are actually running.
- **Single events:** Time Trial (solo hot laps, ghost, leaderboard) and Elimination (last place is culled each lap).
- **Tutorial cards** on the first race; **settings** (volume, zoom, assist, difficulty, quality, save reset); **save/load** via localStorage; procedural WebAudio plus a few announcer clips.

## Debug / test hook

`window.__nitro.debug` exposes `{ state, race, profile, tick(dt, skipRender) }`.
Set `race.autopilot = true` and call `tick(1/60)` in a loop to simulate races
headlessly (used for acceptance testing). Dev server exposes `POST /__shot?name=x`
to dump canvas screenshots into `shots/`.

## Known limitations

- Single chunk > 500 kB (three.js not code-split).
- AI cars don't avoid mines and have simple racing lines.
- Rival cars are stat-scaled per race, not per-rival garage builds.
- Track decoration is sparse placeholder (blob trees, rocks, flags).
