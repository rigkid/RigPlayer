# RigPlayer

**Viewer presents; Player plays.**

RigKit host that **plays** Rig documents (`.rig`) with a fantasy-console loop — palette, tiles, map, and Lua `_init` / `_update` / `_draw`.

Scene sketches without a game loop belong in [RigViewer](https://github.com/rigkid/RigViewer).

## Build

```bash
cmake -S . -B build -DRIGKIT_DIR=../RigKit
cmake --build build --config Release --target RigPlayer
```

Needs sibling [rigDocumentShell](https://github.com/rigkid/rigDocumentShell) at `../rigDocumentShell` or under `RigKit/packs/rigDocumentShell`.

## Run

```bash
build/bin/RigPlayer.exe examples/fantasy-console.rig
# or File → Open… (rigDocumentShell)
```

No path → loads deployed `data/play/fantasy-console.rig`. Relative paths resolve against the current directory (run from the repo root for `examples/…`).

Documents step at a fixed 30 Hz; Lua is sandboxed (no `io` / `os` / `require`). Unknown `rig.*` keys show in the **Skipped keys** window.

## Controls

| Key | `btn` |
|-----|-------|
| Left / Right / Up / Down | 0 / 1 / 2 / 3 |
| Z / C | 4 (O) |
| X / V | 5 (X) |

## Docs

- [docs/port-map.md](docs/port-map.md) — schema + Lua API honesty
