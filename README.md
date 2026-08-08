# RigPlayer

**Viewer presents; Player plays.**

RigKit host that **plays** Rig documents (`.rig`) with a fantasy-console loop — palette, tiles, map, and Lua `_init` / `_update` / `_draw`.

Desktop chrome (File → Open, skipped keys) comes from **[rigDocumentShell](https://github.com/rigkid/rigDocumentShell)** — the same pack [RigViewer](https://github.com/rigkid/RigViewer) uses. Scene sketches without a game loop belong in RigViewer.

## Build

```bash
cmake -S . -B build -DRIGKIT_DIR=../RigKit
cmake --build build --config Release --target RigPlayer
```

Needs sibling [rigDocumentShell](https://github.com/rigkid/rigDocumentShell) at `../rigDocumentShell` or under `RigKit/packs/rigDocumentShell`.

## Run

```bash
build/bin/RigPlayer.exe examples/fantasy-console.rig
build/bin/RigPlayer.exe examples/jailbreak.rig
# or File → Open… (rigDocumentShell)
```

No path → loads deployed `data/play/fantasy-console.rig`. Relative paths resolve against the current directory (run from the repo root for `examples/…`).

Documents step at a fixed 30 Hz; Lua is sandboxed (no `io` / `os` / `require`). Unknown `rig.*` keys show in the **Skipped keys** window.

## Showcase — Jailbreak

Co-op escape campaign from [PicoForge](https://github.com/GitBruno/PicoForge) (`apps/jailbreak`), converted to `.rig` for this host. Audio (`sfx` / `music`) is a silent no-op; graphics and input run in the fantasy-console subset.

```bash
build/bin/RigPlayer.exe examples/jailbreak.rig
```

Re-convert from the cart when PicoForge updates:

```bash
node ../PicoForge/p8-to-rig/cli.js ../PicoForge/apps/jailbreak/jailbreak.p8 -o examples/jailbreak.rig
```

## Controls

| Key | `btn` |
|-----|-------|
| Left / Right / Up / Down | 0 / 1 / 2 / 3 |
| Z / C | 4 (O) |
| X / V | 5 (X) |

## Docs

- [docs/port-map.md](docs/port-map.md) — schema + Lua API honesty

## License

MIT — see [LICENSE](LICENSE).

Jailbreak demo content is from PicoForge (MIT). PICO-8 is a trademark of Lexaloffle Games.
