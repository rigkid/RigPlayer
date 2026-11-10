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
| `rig.geometry.*` | Meshes / primitives; mesh `texcoords` draw with `rig.render.material.albedoMap` |
| `rig.render.material` / `rig.render.light` | Materials + lights. `albedoMap` is a `rig.media.asset_ref` image |
| `rig.render.sprite` | Unit quad with the named texture |
| `rig.mod.lfo` / `rig.mod.binding` | Time-driven bindings |
| `rig.anim.clip` / `rig.anim.track` | Sampled motion on bone transforms. Wrap `once` / `loop` / `ping-pong` |
| `rig.anim.blend` | First blend tree wins (`clip` / `lerp` / `additive`). No tree: idle clip, else the first |
| `rig.anim.skeleton` / `rig.anim.bind` | Bone list and rest pose |
| `rig.anim.skin` | Four-influence CPU skin; extra Spine weights keep the heaviest four |
| Spine 4.x `skeleton.json` + `.atlas` | Encoding at the edge. Packed region UVs come from the atlas. Images from the same drop become the `albedoMap` files |
| `.rigz` | Open and Save. One root `.rig` plus `data/` images |
| `rig.ui.*` | **ImTui** fulfillment (shared `web/imtui` with RigViewer). Each `rig.ui.panel` is its own dockable window (drag title, snap left / right / bottom, `[x]` / View). Controls write `target` + `propertyKey`. Groups honor `collapsed`. Unknown `actionId`s hidden (`lfo.resetPhase` yes). Widget hints: slider / toggle / dropdown / color; `knob` → slider; `xy` when the value is an array. `preferredWidth` / `preferredHeight` ignored. Code is a dockable window, not a second store. |
| `rig.media.code` (`language` glsl) | WebGL2 shader present (`mainImage` / `iTime` style) |

**Desktop:** scene/GLSL File → Open launches the bundled web host (`data/web/rigplayer.html`) with the document inlined, plus sibling / `data/` images (and `.rigz` entries) as `__RIGPLAYER_IMAGES__`. Same present modules as online.

## Hosts

| Surface | Role |
|---------|------|
| **Web** (`player.rig.works`) | Full host — ImTui chrome, same document loop (what makes RigPlayer special) |
| **Desktop** (`RigPlayer.exe`) | Pixel/Lua in-process; scene/GLSL via bundled web host |
| **RigViewer** | Preview only |

Shared desktop File Open chrome: **[rigDocumentShell](https://github.com/rigkid/rigDocumentShell)**.

Spine files stay an encoding. The map lives in RigWorks [docs/spine.md](https://github.com/rigkid/RigWorks/blob/main/docs/spine.md).

When you widen a surface, update this table in the same change.
