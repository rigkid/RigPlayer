# Port map — Rig ↔ RigPlayer

**Viewer presents; Player plays.** This host plays Rig documents (`.rig`) that carry a fantasy-console loop (SUDE + Lua). It is not a scene Viewer.

Same JSON document format as other Rig hosts.

## Document fields (Close)

| Schema | Honesty |
|--------|---------|
| `rig.pixel.palette` | 16 colours → runtime palette |
| `rig.pixel.tile_set` | Sprite sheet RAM |
| `rig.pixel.tile_map` | Map RAM |
| `rig.pixel.canvas` | Accepted (size assumed 128×128) |
| `rig.media.code` (`language` lua / pico8) | Game Lua — sugar rewritten to stock Lua before load |
| `rig.input.buttons` | Document may declare player 0; runtime drives `btn` / `btnp` from host keyboard |
| `rig.meta.named` / document title | Window title |
| `rig.music.transport` / `clock` / `pattern` / `sequencer` | **Web:** Web Audio synth (PICO-8-ish waves 0–7). **Desktop:** still silent |
| `rig.media.asset_ref` / other `rig.*` | **Skipped** — reported in Issues / Skipped keys |

## Lua API (fantasy-console subset)

| API | Status |
|-----|--------|
| `_init` / `_update` / `_draw` | Yes — SUDE at a fixed 30 Hz step |
| `cls`, `btn`, `btnp`, `spr`, `sspr`, `map`, `print` | Yes (`print` uses a 3×5 pixel font) |
| `pset` / `pget` / `mget` / `mset` | Yes |
| `rect` / `rectfill` / `circ` / `circfill` | Yes |
| `color`, `pal`, `fillp` | Yes (draw remap + optional screen `pal(_,_,1)`) |
| `flr` / `mid` / `abs` / `min` / `max` / `rnd` / `sin` / `cos` / `sqrt` | Yes (PICO-8 turn-based `sin`/`cos`) |
| `add` / `del` / `all` / `count` / `split` | Yes |
| `sfx` / `music` | **Web:** plays `rig.music.pattern` via Web Audio. **Desktop:** accepted no-op (silent) |
| `cartdata` / `dget` / `dset` | In-memory only (not persisted) |
| PICO-8 sugar (`!=`, `0b…`, `+=` on names and `a.b` / `a[i]`) | Preprocessed |
| Lua stdlib | Sandboxed — base / table / string / math / coroutine (no `io`, `os`, `require`) |
| Full PICO-8 (peek/poke, menuitem, …) | **No** — out of scope for this host |

## Hosts

| Surface | Role |
|---------|------|
| **Web** (`web/`, `player.rig.works`) | Zero-setup — same `?src=` / `?doc=` / drop / single-file shell as RigViewer; fengari Lua |
| **Desktop** (`RigPlayer.exe`) | RigKit + **rigDocumentShell** chrome |

## Not this host

| Concern | Where |
|---------|--------|
| Geometry / 3D / GLSL sketches | [RigViewer](https://github.com/rigkid/RigViewer) |
| Shared desktop File Open / skipped keys | **[rigDocumentShell](https://github.com/rigkid/rigDocumentShell)** |

When you widen the Lua surface, update this table in the same change.
