# AI share — cart → player URL

Goal: an agent (or human) emits a playable Rig document, then hands the user a link that **plays** it in RigPlayer.

**Viewer presents; Player plays.** Geometry / GLSL sketches go to [RigViewer](https://github.com/rigkid/RigViewer). Pixel + Lua documents open here.

## Ladder (same contract as RigViewer)

| Size | Mechanism | When |
|------|-----------|------|
| **Small** | `?doc=` inline payload | Fits under soft limit |
| **Getting large** | Still `?doc=` + warning banner | Soft limit crossed |
| **Too large** | Refuse Copy link; **Save local** or `?src=` | Hard limit (Jailbreak needs `?src=`) |
| **Any durable share** | `?src=https://…/file.rig` | Gist / git blob / Pages / CDN |
| **This browser only** | `Save local` / `?local=1` | Not a share link |

Budgets match Viewer (`web/share.mjs`): soft **4000** / hard **8000** encoded `?doc=` chars. Formats: `u1.<base64url>` or `z1.<base64url(deflate-raw)>`.

## What to do as an agent

1. Generate / convert a `.rig` with `rig.pixel.*` + Lua `rig.media.code` (see [port-map](port-map.md)).
2. Prefer patterns from [examples/](../examples/) (`fantasy-console.rig`, `jailbreak.rig`).
3. **If small:** Copy link → paste `?doc=` URL.
4. **If hard (Jailbreak):** host the file and reply with:

```
https://player.rig.works/?src=https://gist.githubusercontent.com/.../raw/.../cart.rig
```

(`/web/?…` also works on the hosted site and is the local `npm run serve` path.)

Local preview:

```
npm run serve
http://127.0.0.1:<port>/web/?src=examples/fantasy-console.rig
http://127.0.0.1:<port>/web/?src=examples/jailbreak.rig
http://127.0.0.1:<port>/web/?doc=u1.<payload>
http://127.0.0.1:<port>/web/?local=1
http://127.0.0.1:<port>/web/?embed=1&src=examples/fantasy-console.rig
```

## Embed

`?embed=1` hides the host menu bar:

```html
<iframe
  src="https://player.rig.works/?embed=1&src=examples/fantasy-console.rig"
  title="RigPlayer"
  style="width:100%;height:420px;border:0;border-radius:8px;background:#0b0d10"
  allow="fullscreen"
></iframe>
```

## Domain

Preferred host (pin): **`https://player.rig.works`**. Fallback: `https://rigkid.github.io/RigPlayer/`. Keep `?src=` and `?doc=` stable — that is the agent contract.
