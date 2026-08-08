# RigPlayer

**Viewer presents; Player plays.**

Zero-setup player for [RigWorks](https://github.com/rigkid/RigWorks) documents — fantasy-console loop (palette, tiles, map, Lua `_init` / `_update` / `_draw`).

Scene sketches without a game loop belong in [RigViewer](https://github.com/rigkid/RigViewer). Desktop chrome (File → Open, skipped keys) shares **[rigDocumentShell](https://github.com/rigkid/rigDocumentShell)** with Viewer.

## Zero-setup (web)

Same open / share shell as RigViewer: drop a `.rig`, File → Open, `?src=`, `?doc=`, `?local=`, `?embed=1`, Copy link, Save local, single-file HTML.

Same validator, too: [`web/validate.mjs`](web/validate.mjs) is ported from RigViewer's — envelope checks, misplaced components, unknown-schema suggestions — with Player's known schemas (`rig.pixel.*`, `rig.media.code`, `rig.input.buttons`) swapped in for Viewer's scene ones. If a document fails to load, an **Issues** button appears in the header instead of a silent failure; click it (or it auto-opens on errors) to see exactly what's wrong and why.

| | |
|--|--|
| Live | **https://player.rig.works/** |
| Fallback | https://rigkid.github.io/RigPlayer/ |
| Offline | [`dist/rigplayer.html`](dist/rigplayer.html) — double-click, no server needed |

The offline file is truly zero-setup: `file://` pages can't `fetch()` sibling files (null origin, no CORS), so `tools/bundle.mjs` inlines Fantasy console + Jailbreak straight into the HTML — File → Examples and the default demo work with no network or local server. `?src=`/`?doc=`/dropped files still need a server or a reachable URL, same as any browser fetch.

```bash
npm run serve
# http://127.0.0.1:8766/web/?src=examples/fantasy-console.rig
# http://127.0.0.1:8766/web/?src=examples/jailbreak.rig
```

```bash
npm run bundle   # → dist/rigplayer.html (+ web/rigplayer.html)
npm test
```

Agent share ladder: [docs/ai-share.md](docs/ai-share.md) · discovery: [`llms.txt`](llms.txt).

## Desktop (RigKit)

```bash
cmake -S . -B build -DRIGKIT_DIR=../RigKit
cmake --build build --config Release --target RigPlayer
build/bin/RigPlayer.exe examples/jailbreak.rig
```

Needs sibling [rigDocumentShell](https://github.com/rigkid/rigDocumentShell) at `../rigDocumentShell` or under `RigKit/packs/rigDocumentShell`.

No path → loads deployed `data/play/fantasy-console.rig`.

## Showcase — Jailbreak

Co-op escape campaign from [PicoForge](https://github.com/GitBruno/PicoForge) (`apps/jailbreak`). Prefer `?src=` — too large for `?doc=`.

```bash
# web
http://127.0.0.1:8766/web/?src=examples/jailbreak.rig
# desktop
build/bin/RigPlayer.exe examples/jailbreak.rig
```

Audio (`sfx` / `music`) is silent; cartdata is in-memory only.

## Controls

| Key | `btn` |
|-----|-------|
| Left / Right / Up / Down | 0 / 1 / 2 / 3 |
| Z / C | 4 (O) |
| X / V | 5 (X) |

## Docs

- [docs/port-map.md](docs/port-map.md) — schema + Lua API honesty
- [docs/ai-share.md](docs/ai-share.md) — `?doc=` / `?src=` ladder

## Repo layout

| Path | Role |
|------|------|
| `web/` | Hosted fengari player (zero-setup) |
| `dist/rigplayer.html` | Single-file offline player |
| `PlayRuntime.*` / `RigPlayerApp.*` | Desktop RigKit host |
| `examples/` | Specimen `.rig` documents |
| `docs/` | Port map + AI share |

## Publish / GitHub Pages

1. GitHub → **Settings → Pages → Source: GitHub Actions**.
2. Custom domain **`player.rig.works`** (CNAME is written by the workflow).
3. After a green `pages` workflow: site root + `/web/`, `dist/rigplayer.html`, `examples/`, `llms.txt`.

## License

MIT — see [LICENSE](LICENSE).

Jailbreak demo content is from PicoForge (MIT). PICO-8 is a trademark of Lexaloffle Games. Fengari is MIT — see `web/vendor/LICENSE.fengari.txt`.
