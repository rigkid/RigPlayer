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
| `rig.input.buttons` | Document may declare player 0; runtime drives `btn` from host keyboard |
| `rig.meta.named` / document title | Window title |
| Any other `rig.*` (music, geometry, …) | **Skipped** — reported in the Skipped keys window (rigDocumentShell) |

## Lua API (fantasy-console subset)

| API | Status |
|-----|--------|
| `_init` / `_update` / `_draw` | Yes — SUDE at a fixed 30 Hz step |
| `cls`, `btn`, `spr`, `map`, `print` | Yes (`print` uses a 3×5 pixel font) |
| `pset` / `pget` / `mget` | Yes |
| `rectfill` / `circfill` | Yes |
| PICO-8 sugar (`!=`, `+=`, …) | Preprocessed |
| Lua stdlib | Sandboxed — base / table / string / math / coroutine (no `io`, `os`, `require`) |
| Full PICO-8 (SFX, music, peek/poke, …) | **No** — out of scope for this host |

## Not this host

| Concern | Where |
|---------|--------|
| Geometry / 3D / GLSL sketches | [RigViewer](https://github.com/rigkid/RigViewer) |
| Shared File Open / skipped keys chrome | **rigDocumentShell** |

When you widen the Lua surface, update this table in the same change.
