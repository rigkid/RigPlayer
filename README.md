# RigPlayer

**Full RigWorks host** — online (`player.rig.works`) is the special surface; desktop matches.

Opens Rig documents end-to-end: pixel/Lua runtime, music, **and** scene/GLSL + code-editor documents. Browser chrome is **ImTui** — the same dockable window shell as [RigViewer](https://github.com/rigkid/RigViewer) (`web/imtui/`, vendored from Viewer). Drag a title to dock left / right / bottom; close with `[x]`; reopen from **View**. That is the web **IMui** fulfillment: RigKit documents run in the page; the toolkit is the grid, not DOM cards.

Desktop chrome (File → Open, skipped keys) shares **[rigDocumentShell](https://github.com/rigkid/rigDocumentShell)** with Viewer.

## Zero-setup (web)

Drop a `.rig` / `.json`, File → Open, `?src=`, `?doc=`, `?local=`, `?embed=1`, Copy link, Save local, single-file HTML.

**No hosting needed:** a `?doc=` link carries the whole document inside the URL — load a file, **File → Copy link**, paste anywhere. Step-by-step: [docs/data-url.md](docs/data-url.md) (also in-app under **Help → Load via data URL**).

**Phones:** a touch d-pad + O/X buttons appear automatically for pixel/Lua documents on coarse-pointer devices.

Validator ([`web/validate.mjs`](web/validate.mjs)) knows the union of pixel/Lua and scene/GLSL schemas. Failures show in the **Issues** panel.

| | |
|--|--|
| Live | **https://player.rig.works/** |
| Fallback | https://rigkid.github.io/RigPlayer/ |
| Offline | [`dist/rigplayer.html`](dist/rigplayer.html) — double-click, no server needed |

`tools/bundle.mjs` inlines examples (Jailbreak, demo-3d, demo-gleditor) for `file://` offline use.

```bash
npm run serve
# http://127.0.0.1:8766/web/?src=examples/jailbreak.rig
# http://127.0.0.1:8766/web/?src=examples/demo-3d.json
# http://127.0.0.1:8766/web/?src=examples/demo-gleditor.json
```

```bash
npm run bundle   # → dist/rigplayer.html (+ web/rigplayer.html)
npm test
```

Agent share ladder: [docs/ai-share.md](docs/ai-share.md) · discovery: [`llms.txt`](llms.txt).

## Desktop (RigKit)

```bash
npm run bundle   # required once — deploys data/web/rigplayer.html for scene/GLSL opens
cmake -S . -B build -DRIGKIT_DIR=../RigKit
cmake --build build --config Release --target RigPlayer
build/bin/RigPlayer.exe examples/jailbreak.rig
build/bin/RigPlayer.exe examples/demo-3d.json
```

Pixel/Lua documents run in-process. Scene/GLSL documents open the bundled web host with the file inlined (same present path as online).

No path → loads deployed `data/play/jailbreak.rig`.

## Examples

| Document | Path |
|----------|------|
| Jailbreak (pixel/Lua) | `examples/jailbreak.rig` |
| Demo 3D (scene) | `examples/demo-3d.json` |
| GLSL editor | `examples/demo-gleditor.json` |

Web audio: `sfx` / `music` from `rig.music.pattern` (click or key once to unlock). Desktop pixel runtime is still silent for audio. `cartdata` is in-memory only.

## Controls (pixel/Lua)

| Key | `btn` |
|-----|-------|
| Left / Right / Up / Down | 0 / 1 / 2 / 3 |
| Z / C | 4 (O) |
| X / V | 5 (X) |

Touch devices get an on-screen 8-way d-pad (btn 0–3) and O / X buttons (btn 4 / 5) — no keyboard needed.

## Docs

- [docs/port-map.md](docs/port-map.md) — schema honesty
- [docs/data-url.md](docs/data-url.md) — load from a `?doc=` data URL, no hosting
- [docs/ai-share.md](docs/ai-share.md) — `?doc=` / `?src=` ladder

## Repo layout

| Path | Role |
|------|------|
| `web/` | Online host (ImTui + fengari + Three/GLSL present) |
| `web/imtui/` | Shared ImTui host (vendored from RigViewer — `npm run sync:tui`) |
| `web/view/` | Scene/GLSL present modules (from RigViewer) |
| `dist/rigplayer.html` | Single-file offline host |
| `PlayRuntime.*` / `RigPlayerApp.*` | Desktop RigKit host |
| `examples/` | Specimen Rig documents |
| `docs/` | Port map + AI share |

## Publish / GitHub Pages

1. GitHub → **Settings → Pages → Source: GitHub Actions**.
2. Custom domain **`player.rig.works`** (CNAME is written by the workflow).
3. After a green `pages` workflow: site root + `/web/`, `dist/rigplayer.html`, `examples/`, `llms.txt`.

## License

MIT — see [LICENSE](LICENSE).

Jailbreak demo content is from PicoForge (MIT). PICO-8 is a trademark of Lexaloffle Games. Fengari is MIT — see `web/vendor/LICENSE.fengari.txt`. Three.js is MIT — see `web/vendor/three.module.js` header.
