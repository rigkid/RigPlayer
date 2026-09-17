# Load a document from a data URL (`?doc=`)

The whole document travels **inside the link**. Nothing is hosted anywhere;
there is no external JSON to fetch. Paste the URL into chat, an issue, a note —
opening it loads the document.

## Easiest: let the player build the link (works on a phone)

1. Open **https://player.rig.works/**.
2. Load your document — drop the `.rig` / `.json` onto the page, or **File → Open**.
3. **File → Copy link**.
4. The clipboard now holds a `?doc=` URL that *contains* the document.

If the clipboard is blocked, the player writes the URL into the address bar
instead — copy it from there. In-app reminder: **Help → Load via data URL**.

## By hand (agents / scripts)

Payload format, decoded by [`web/share.mjs`](../web/share.mjs):

```
?doc=u1.<base64url(utf-8 JSON)>          # plain
?doc=z1.<base64url(deflate-raw JSON)>    # compressed — usually much shorter
```

`base64url` = standard base64 with `+`→`-`, `/`→`_`, no `=` padding.
The player's own Copy link encodes both and keeps the shorter one.

Node one-liners:

```bash
# u1 — plain
node -e "console.log('https://player.rig.works/?doc=u1.'+require('fs').readFileSync(process.argv[1]).toString('base64url'))" doc.json

# z1 — deflate-raw
node -e "const z=require('zlib'),f=require('fs');console.log('https://player.rig.works/?doc=z1.'+z.deflateRawSync(f.readFileSync(process.argv[1])).toString('base64url'))" doc.json
```

## Size limits

| Encoded `?doc=` chars | What happens |
|-----------------------|--------------|
| ≤ 4000 | Fine everywhere |
| 4000 – 8000 | Loads, but the player warns — long URLs break in some chat clients |
| > 8000 | Copy link refuses. **File → Save local** (this browser only, reopen with `?local=1`), or host the file and use `?src=` |

## Variants

```
https://player.rig.works/?doc=z1.<payload>
https://player.rig.works/?embed=1&doc=z1.<payload>   # stage only, no menu chrome
dist/rigplayer.html?doc=z1.<payload>                 # offline single file understands it too
```
