# Musicwire

[![Smithery](https://img.shields.io/badge/Smithery-View_Server-6b46c1)](https://smithery.ai/servers/thatdudealso/musicwire)
[![x402-list](https://x402-list.com/badge/musicwire.svg)](https://x402-list.com/services/musicwire?utm_source=badge&utm_medium=referral&utm_campaign=embed)

Musicwire validates MusicXML, renders it with MuseScore, runs automated QC, and returns attributed MP3 and MIDI files with signed provenance receipts. It is an API for turning a score your workflow authored into files people can hear and edit - it does not compose music or use a server-side LLM.

## How to use it

### For humans

Bring MusicXML from your notation or agent workflow, then receive a listenable MP3, editable MIDI, and a receipt to verify the exact rendered files. Start with the [live docs](https://musicwire.5432wire.com/docs) for the full guided flow and ready-to-use example scores.

### For agents

The hosted API is `https://musicwire.5432wire.com`. Fetch the free authoring guide, validate a complete score, then pay and submit the render. Fund the buyer wallet with USDC on the network named in the service's x402 quote before the paid request.

```sh
export MUSICWIRE_URL='https://musicwire.5432wire.com'

# Free: get the MusicXML authoring guide.
curl -sS "$MUSICWIRE_URL/v1/compose-guide?style=waltz&key=C%20major&tempo=96"

# Download a complete example and validate it. The first paid request returns the x402 quote.
curl -sS "$MUSICWIRE_URL/examples/02-solo-piano-sunroom-parade.musicxml" -o score.musicxml
curl -sS -X POST "$MUSICWIRE_URL/v1/validate" \
  -H 'content-type: application/xml' --data-binary @score.musicxml

# Make the render body, then let an x402 buyer pay and retry the request.
node -e 'const fs=require("fs"); process.stdout.write(JSON.stringify({musicxml:fs.readFileSync("score.musicxml","utf8"),formats:["mp3","midi"]}))' > request.json
X402_PRIVATE_KEY="$FUNDED_KEY" x402curl --x402-rpc-url https://mainnet.base.org \
  -X POST -H 'content-type: application/json' -H 'Idempotency-Key: musicwire-example-001' \
  --data-binary @request.json "$MUSICWIRE_URL/v1/render"

# Or install the payment-aware stdio MCP server for an MCP client.
MUSICWIRE_API_URL="$MUSICWIRE_URL" MUSICWIRE_X402_PRIVATE_KEY="$FUNDED_KEY" \
  npx -y musicwire-mcp
```

The hosted MCP endpoint is `https://musicwire.5432wire.com/mcp`; it returns the x402 quote for paid tools, so the calling agent supplies the `Payment-Signature`. See the [live docs](https://musicwire.5432wire.com/docs), [MCP README](mcp/README.md), and [API manifest](https://musicwire.5432wire.com/manifest) for endpoint details, payment behavior, and local setup.

## Demos

https://github.com/user-attachments/assets/3c4ff883-fd01-4fce-95b9-532e2e1a25b1

For humans: An end-to-end look at taking a score from a request to audio you can play and a receipt you can keep.

For agents: Fetch the guide, submit MusicXML for validation and rendering, then poll the resulting job for deliverables.

https://github.com/user-attachments/assets/b63cac9d-b6b6-4c5c-b14d-17ebade2dbdf

For humans: A festival-scale EDM anthem rendered from a complete score.

For agents: Use MusicXML with `formats: ["mp3", "midi"]` to produce an audio preview and an editable MIDI deliverable.

https://github.com/user-attachments/assets/003dba17-f5fa-49dd-8842-8c3fc31dda44

For humans: A high-energy metalcore gym track rendered as a playable result.

For agents: Submit a fully specified heavy arrangement and let Musicwire validate, render, and QC the requested outputs.

https://github.com/user-attachments/assets/b1780656-6ab6-40a2-8737-e2bf87bf1875

For humans: A modern country drive that shows the same workflow can carry a different musical character.

For agents: Adapt the authoring guide to the target style, then render the completed MusicXML into listening and editing formats.

https://github.com/user-attachments/assets/31a40aab-a97e-48ce-8c4d-2466e50fa492

For humans: A Spanish reggaeton dembow rendered from notation into a track you can hear.

For agents: Use the same API contract for a rhythm-led score and keep the returned provenance receipt with the artifacts.
