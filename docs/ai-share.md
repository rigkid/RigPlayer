# AI share — document → player URL

Goal: an agent (or human) emits a Rig document, then hands the user a link that **opens** it in RigPlayer (full RigWorks host).

[RigViewer](https://github.com/rigkid/RigViewer) is the light **preview**. Prefer Player links for durable share.

## Ladder (same contract as RigViewer)

| Size | Mechanism | When |
|------|-----------|------|
| **Small** | `?doc=` inline payload | Fits under soft limit |
| **Getting large** | Still `?doc=` + warning banner | Soft limit crossed |
| **Too large** | Refuse Copy link; **Save local** or `?src=` | Hard limit (Jailbreak needs `?src=`) |
| **Any durable share** | `?src=https://…/file.rig` | Gist / git blob / Pages / CDN |
| **This browser only** | `Save local` / `?local=1` | Not a share link |

Budgets match Viewer (`web/share.mjs`): soft **4000** / hard **8000** encoded `?doc=` chars. Formats: `u1.<base64url>` or `z1.<base64url(deflate-raw)>`.

Step-by-step `?doc=` how-to (no hosting, no external JSON): [data-url.md](data-url.md).

## What to do as an agent

1. Generate a `.rig` / `.json` with RigWorks schemas (see [port-map](port-map.md)).
2. Prefer patterns from [examples/](../examples/).
3. **If it doesn't load:** open **View → Issues** (Document panel) — fix envelope errors before sharing.
4. **If small:** Copy link → paste `?doc=` URL.
5. **If hard:** host the file and reply with:

```
https://player.rig.works/?src=https://gist.githubusercontent.com/.../raw/.../doc.rig
```

(`/web/?…` also works on the hosted site and is the local `npm run serve` path.)

Local preview:

```
npm run serve
http://127.0.0.1:<port>/web/?src=examples/jailbreak.rig
http://127.0.0.1:<port>/web/?src=examples/demo-3d.json
http://127.0.0.1:<port>/web/?src=examples/demo-gleditor.json
http://127.0.0.1:<port>/web/?doc=u1.<payload>
http://127.0.0.1:<port>/web/?local=1
http://127.0.0.1:<port>/web/?embed=1&src=examples/demo-gleditor.json
```

## Embed

`?embed=1` hides the host menu bar:

```html
<iframe
  src="https://player.rig.works/?embed=1&src=examples/demo-gleditor.json"
  title="RigPlayer"
  style="width:100%;height:420px;border:0;border-radius:8px;background:#0b0d10"
  allow="fullscreen"
></iframe>
```

## Domain

Preferred host (pin): **`https://player.rig.works`**. Fallback: `https://rigkid.github.io/RigPlayer/`. Keep `?src=` and `?doc=` stable — that is the agent contract.
