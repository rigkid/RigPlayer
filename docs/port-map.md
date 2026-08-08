# Port map — RigWorks ↔ RigPlayer

**RigPlayer is the full RigWorks host** (online + desktop). [RigViewer](https://github.com/rigkid/RigViewer) is the light **preview** of the same documents.

Same JSON document format as other Rig hosts. Document shape selects the path:

- **Pixel/Lua runtime** — `rig.pixel.*` + `rig.media.code` (`lua` / `pico8`)
- **Scene/GLSL present** — geometry / spatial / render / UI, or `rig.media.code` (`glsl`)

## Pixel / Lua runtime

| Schema | Honesty |
|--------|---------|
| `rig.pixel.palette` | 16 colours → runtime palette |
| `rig.pixel.tile_set` | Sprite sheet RAM (row-major sheet indices) |
| `rig.pixel.tile_map` | Map RAM |
| `rig.pixel.canvas` | Accepted (size assumed 128×128) |
| `rig.media.code` (`language` lua / pico8) | Lua — sugar rewritten to stock Lua before load |
| `rig.input.buttons` | Document may declare player 0; runtime drives `btn` / `btnp` from host keyboard |
| `rig.meta.named` / document title | Window title |
| `rig.music.transport` / `clock` / `pattern` / `sequencer` | **Web:** Web Audio synth (waves 0–7). **Desktop pixel path:** silent |
| `rig.media.asset_ref` | Companion note (metadata only) |

### Lua API (pixel runtime)

| API | Status |
|-----|--------|
| `_init` / `_update` / `_draw` | Yes — fixed 30 Hz step |
| `cls`, `btn`, `btnp`, `spr`, `sspr`, `map`, `print` | Yes (`print` uses a 3×5 pixel font) |
| `pset` / `pget` / `mget` / `mset` | Yes (fractional coords floored) |
| `rect` / `rectfill` / `circ` / `circfill` | Yes |
| `color`, `pal`, `fillp` | Yes |
| `flr` / `mid` / `abs` / `min` / `max` / `rnd` / `sin` / `cos` / `sqrt` | Yes |
| `add` / `del` / `all` / `count` / `split` | Yes |
| `sfx` / `music` | **Web:** plays `rig.music.pattern`. **Desktop pixel path:** no-op |
| `cartdata` / `dget` / `dset` | In-memory only |
| PICO-8 sugar (`!=`, `0b…`, `+=`) | Preprocessed |
| Lua stdlib | Sandboxed — base / table / string / math / coroutine |

## Scene / GLSL present

| Schema | Honesty |
|--------|---------|
| `rig.spatial.*` | Transforms, camera, groups — Three.js present (web) |
| `rig.geometry.*` | Meshes / primitives |
| `rig.render.material` / `rig.render.light` | Materials + lights |
| `rig.mod.lfo` / `rig.mod.binding` | Time-driven bindings |
| `rig.ui.*` | Panels / controls / actions + code editor |
| `rig.media.code` (`language` glsl) | WebGL2 shader present (`mainImage` / `iTime` style) |

**Desktop:** scene/GLSL File → Open launches the bundled web host (`data/web/rigplayer.html`) with the document inlined — same present modules as online.

## Hosts

| Surface | Role |
|---------|------|
| **Web** (`player.rig.works`) | Full host — what makes RigPlayer special |
| **Desktop** (`RigPlayer.exe`) | Pixel/Lua in-process; scene/GLSL via bundled web host |
| **RigViewer** | Preview only |

Shared desktop File Open chrome: **[rigDocumentShell](https://github.com/rigkid/rigDocumentShell)**.

When you widen a surface, update this table in the same change.
