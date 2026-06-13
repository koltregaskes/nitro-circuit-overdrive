# Nitro Circuit Overdrive

A 2.5D top-down / near-isometric arcade racer vertical slice. Original game — no
copyrighted assets. TypeScript + Vite + Three.js, all graphics procedural
(code-generated meshes, no asset files).

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

| Key | Action |
|---|---|
| `W A S D` / arrows | throttle / brake / steer |
| `L-Shift` | boost (meter drains, regenerates) |
| `F` | front missile (homing, hits first racer ahead) |
| `E` | drop mine behind |
| `Esc` | pause (resume / restart / forfeit) |

## What's in the slice

- **Camera:** fixed-orientation orthographic top-down with a slight tilt
  (~64° elevation). Never becomes a chase camera. Camera zoom adjustable in settings.
- **1 cup, 4 races:** Autumn Cup 2026 — Dockyard Dash, Forest Run, Glacier Gate,
  Neon Boulevard (4 themes: desert, forest, snow, night; 3–4 laps).
- **6 cars per race:** player + 5 named AI rivals with distinct skill levels,
  corner-speed awareness, rubber-banding, and AI item/boost usage.
- **Arcade handling:** forgiving grip model with drift slip, optional steering
  assist, grass slowdown, soft outer boundaries (no hard walls, no insta-death).
- **Weapons & damage:** boost meter, homing front missiles, proximity mines,
  armour, spin-outs, wreck = brief stun + partial auto-repair (forgiving).
  Damage persists after the race as car condition; repair in the garage.
- **Garage/shop:** 4 upgrade lines × 5 levels (engine/handling/armour/boost),
  missile/mine purchases, full repair, 3 buyable cars (Rival-X starter,
  Kolt-47, Vex-77).
- **Tournament:** points table (10/8/6/4/2/1), prize money, cup standings,
  champion bonus, new-cup restart that keeps your money/cars.
- **Tutorial cards** on first race; **settings** (volume, zoom, assist, save reset);
  **save/load** via localStorage; procedural WebAudio sound (engine, weapons, UI).

## Debug / test hook

`window.__nitro.debug` exposes `{ state, race, profile, tick(dt, skipRender) }`.
Set `race.autopilot = true` and call `tick(1/60)` in a loop to simulate races
headlessly (used for acceptance testing). Dev server exposes `POST /__shot?name=x`
to dump canvas screenshots into `shots/`.

## Known limitations

- Single chunk > 500 kB (three.js not code-split) — fine for a slice.
- No gamepad support yet (keyboard only).
- AI cars don't avoid mines and have simple racing lines.
- Rival cars are stat-scaled per race, not per-rival garage builds.
- Track decoration is sparse placeholder (blob trees, rocks, flags).
