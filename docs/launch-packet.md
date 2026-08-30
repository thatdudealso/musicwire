# Musicwire listing and registry launch packet

Prepared 2026-08-21. This packet is for the Captain to execute in order. It does not authorize an account creation, a public submission, a package publication, or a paid request.

## 1. Canonical record

| Field             | Value                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product           | Musicwire                                                                                                                                                                                                    |
| One-line tagline  | Pay-per-call MusicXML validation, MuseScore rendering, and automated QC for AI agents.                                                                                                                       |
| Description       | Musicwire validates MusicXML, renders scores with MuseScore, and returns QC-checked MP3 audio for listening and MIDI for editing. It uses x402 Exact USDC on Base and captures payment only after QC passes. |
| Landing page      | https://musicwire.5432wire.com/                                                                                                                                                                              |
| Documentation     | https://musicwire.5432wire.com/docs                                                                                                                                                                          |
| Health check      | https://musicwire.5432wire.com/health                                                                                                                                                                        |
| API manifest      | https://musicwire.5432wire.com/manifest                                                                                                                                                                      |
| x402 description  | https://musicwire.5432wire.com/.well-known/x402                                                                                                                                                              |
| Repository        | https://github.com/thatdudealso/musicwire                                                                                                                                                                    |
| Support           | https://github.com/thatdudealso/musicwire/issues                                                                                                                                                             |
| Logo              | https://musicwire.5432wire.com/musicwire-mark.svg                                                                                                                                                            |
| Network           | Base mainnet, `eip155:8453`                                                                                                                                                                                  |
| Asset             | USDC, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                                                                                                                                                           |
| Receiving address | `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`                                                                                                                                                                 |
| Payment provider  | CDP facilitator                                                                                                                                                                                              |

Use this copy verbatim where a directory has a short description:

> Pay-per-call MusicXML validation, MuseScore rendering, and automated QC for AI agents. Musicwire returns actionable score errors, MP3 audio for listening, and MIDI for editing, and charges only after QC passes.

Use cases:

- Validate agent-generated MusicXML before sending it to a musician or renderer.
- Render a score to MP3 for listening or MIDI for editing after validation.
- Require key, tempo, and duration constraints, with no charge when QC fails.

Claims to retain: "validate, render, QC, and return artifacts" and "charge only after QC passes." Do not describe Musicwire as a composition model.

## 2. Launch packet checklist

- [x] First-party HTTPS landing page, docs, health route, manifest, and x402 description are live.
- [x] Live pricing is $0.10 for validation, $0.25 for a one-part render, and $0.50 for a multi-part render.
- [x] Production quotes Base mainnet Exact USDC to the recorded receiving address.
- [x] Bazaar declarations for `POST /v1/validate` and `POST /v1/render` are present in this PR. Deploy this PR before the Bazaar settlement and validation steps.
- [x] A 512 px square SVG logo is available at `/musicwire-mark.svg`.
- [x] Official MCP Registry metadata is prepared in [`mcp/server.json`](../mcp/server.json).
- [x] A client configuration is prepared in [`.mcp.json`](../.mcp.json). It contains no private key.
- [x] npm discovery metadata is prepared in [`mcp/package.json`](../mcp/package.json).
- [ ] Publish `musicwire-mcp@0.1.2`. This is blocked by the separate captain-owned npm credential task. Do not publish this repository's private root package.
- [ ] Capture a settled production render and retain its response body, `receipt.tx_hash`, and artifact link. The paid command is in the Bazaar section below.
- [ ] Select an official privacy-policy URL. No privacy policy is currently published.
- [ ] Capture three current images immediately before submission: landing-page hero, documentation quickstart, and a terminal or response view showing a successful settled purchase. Do not use the rate-limited or pre-settlement view as proof.

The MCP package remains the stdio install path. The public Streamable HTTP endpoint is `https://musicwire.5432wire.com/mcp` and is advertised in `mcp/server.json` remotes after the npm version bump. Claude Connectors and Smithery should use that hosted URL; they must not be given a server-held wallet.

For the three listing images, use a 1440 by 1024 browser viewport, wait for the manifest-backed values to load, and capture the landing hero and documentation quickstart. Capture the settlement response only after the captain-approved purchase succeeds. Save the final files as `musicwire-landing.png`, `musicwire-docs.png`, and `musicwire-settlement.png`; do not commit a buyer key, payment signature, or presigned artifact URL into the images.

## 3. Day-0 captain runbook

### 3.1 CDP x402 Bazaar

Prerequisite: merge and deploy this PR so live `402` responses include the Bazaar extension for both paid routes. The metadata uses explicit JSON input and output schemas, service name `Musicwire`, and tags `musicxml`, `rendering`, and `qc`. The public manifest states `discoverable: true` and `payment.discovery.bazaar.discoverable: true`.

Before paying, inspect the route from a clean external network:

```sh
curl -sS -i -X POST 'https://musicwire.5432wire.com/v1/render' \
  -H 'content-type: application/json' \
  --data '{"musicxml":"<?xml version=\"1.0\"?><score-partwise version=\"4.0\"></score-partwise>","formats":["mp3","midi"]}'
```

The command must return `402` and its decoded `Payment-Required` value must contain `extensions.bazaar`, `eip155:8453`, the Base mainnet USDC address, the receiving address above, and an amount of `250000` atomic USDC units.

Use the committed one-part fixture for the settled proof. It costs exactly **0.25 USDC** for Musicwire's render. The buyer wallet may separately need enough Base ETH for any wallet-side gas that its chosen buyer flow requires.

```sh
export MUSICWIRE_URL='https://musicwire.5432wire.com'
REQUEST_JSON="$(tr -d '\n' < test/fixtures/two-bar-piano-render-request.json)"
npx -y awal x402 pay "$MUSICWIRE_URL/v1/render" \
  -X POST \
  -d "$REQUEST_JSON" \
  -h '{"content-type":"application/json","Idempotency-Key":"musicwire-bazaar-proof-20260821"}' \
  --max-amount 250000 \
  --json
```

Record the JSON response, job ID, `receipt.tx_hash`, capture time, quoted `payTo`, and the finished MP3 and MIDI URLs. Then check Bazaar by merchant and by route after its catalog delay. Bazaar has no separate registration form.

### 3.2 Official MCP Registry

Record:

| Field            | Value                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Name             | `io.github.thatdudealso/musicwire-mcp`                                                           |
| Package          | `musicwire-mcp@0.1.2`                                                                            |
| Transport        | stdio via `npx -y musicwire-mcp`; streamable-http remote at `https://musicwire.5432wire.com/mcp` |
| Registry file    | `mcp/server.json`                                                                                |
| Repository ID    | `1337252218`                                                                                     |
| API URL default  | `https://musicwire.5432wire.com`                                                                 |
| Paid-tool secret | `MUSICWIRE_X402_PRIVATE_KEY`                                                                     |

After npm has published the exact `0.1.2` package, validate and publish from the repository checkout:

```sh
cd mcp
mcp-publisher validate server.json
mcp-publisher login github
mcp-publisher publish server.json
```

The GitHub login must be the `thatdudealso` identity that owns the `io.github.thatdudealso/*` namespace. Keep the published registry URL in the tracking table below.

### 3.3 Smithery

Prepared record: name `musicwire`, package `musicwire-mcp`, repository and docs URLs above, logo URL above, and the canonical description. The hosted Streamable HTTP URL is `https://musicwire.5432wire.com/mcp`. Do not enter the site root `https://musicwire.5432wire.com` as an MCP URL.

### 3.4 x402all

| Form field        | Value                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Origin / website  | `https://musicwire.5432wire.com/`                                                                                                                      |
| API base URL      | `https://musicwire.5432wire.com`                                                                                                                       |
| Category          | Media                                                                                                                                                  |
| Wallet            | `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`                                                                                                           |
| Network and asset | Base mainnet `eip155:8453`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                                                                          |
| Protected routes  | `POST /v1/validate`, `POST /v1/render`                                                                                                                 |
| Notes             | x402 Exact USDC through CDP. Validation is $0.10. Render is $0.25 for one part and $0.50 for multiple parts. Payment is captured only after QC passes. |
| Contact email     | Captain-provided launch contact                                                                                                                        |

Submit only after the deployed Bazaar extension and settled purchase have both been verified.

### 3.5 x402 List

Use the x402all record unchanged, with these additional values:

| Form field          | Value                                             |
| ------------------- | ------------------------------------------------- |
| First-party website | `https://musicwire.5432wire.com/`                 |
| Documentation       | `https://musicwire.5432wire.com/docs`             |
| Health check        | `https://musicwire.5432wire.com/health`           |
| Category            | Media or Developer Tools, if Media is unavailable |
| Description         | Canonical short description in section 1          |
| Contact email       | Captain-provided launch contact                   |

Run the external 402 probe immediately before submitting. Do not resubmit during its stated review window.

## 4. Days 1 to 7 records

### Claude Connectors Directory

The remote connector URL is `https://musicwire.5432wire.com/mcp`. The prepared reviewer record is the canonical description, repository, docs, support URL, paid-tool behavior, and a statement that `musicwire_validate` and `musicwire_render` return x402 `402 Payment Required` until the caller retries with a signed payment. Musicwire does not hold a buyer wallet. Remaining listing gates (privacy-policy URL if a directory requires one, current security-review material) are still captain-owned.

### Glama, PulseMCP, and mcp.so

Use these common fields once `musicwire-mcp@0.1.2` and the Official Registry entry are live:

| Field                   | Value                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Name                    | Musicwire MCP                                                                                                                             |
| GitHub URL              | `https://github.com/thatdudealso/musicwire`                                                                                               |
| Package                 | `musicwire-mcp@0.1.2`                                                                                                                     |
| Registry name           | `io.github.thatdudealso/musicwire-mcp`                                                                                                    |
| Install command         | `npx -y musicwire-mcp`                                                                                                                    |
| Logo                    | `https://musicwire.5432wire.com/musicwire-mark.svg`                                                                                       |
| Support                 | `https://github.com/thatdudealso/musicwire/issues`                                                                                        |
| Connection instructions | See the committed `.mcp.json` and `mcp/README.md`. Set the buyer key in the process environment, never in committed client configuration. |

For mcp.so, choose the free queued review. Do not buy placement. If PulseMCP's form is access-denied, use its published support channel rather than automating around bot protection.

### GitHub topics and npm keywords

Captain GitHub topics, in priority order:

```text
mcp
mcp-server
model-context-protocol
x402
http-402
musicxml
musescore
music-notation
ai-agents
agentic-commerce
```

The npm keywords are already prepared in `mcp/package.json`: `mcp`, `model-context-protocol`, `musicxml`, `musescore`, `music-notation`, `x402`, `ai-agents`, and `agent-tools`.

### Awesome-list PR drafts

For an MCP list, submit a one-line entry in the list's current music, audio, or media category:

```md
- [Musicwire](https://github.com/thatdudealso/musicwire) - Paid MusicXML validation, MuseScore rendering, and automated QC for AI agents; payment is captured only after QC passes.
```

For `xpaysh/awesome-x402`, submit this entry in its current live API or MCP-adjacent category:

```md
- [Musicwire](https://musicwire.5432wire.com/) - x402-paid MusicXML validation and MuseScore rendering with automated QC before settlement.
```

Open each PR only after the npm package and Official Registry record resolve publicly. Follow the target repository's current contribution instructions and do not add unrelated formatting changes.

## 5. Submission tracking and verification

Maintain this table privately after each captain action:

| Channel               | Submitted URL     | Canonical URL | State | Recheck                     | Result signal                         |
| --------------------- | ----------------- | ------------- | ----- | --------------------------- | ------------------------------------- |
| CDP Bazaar            | N/A               |               |       | +10 minutes                 | searchable resource and settled proof |
| Official MCP Registry | `mcp/server.json` |               |       | after publish               | package install and registry status   |
| Smithery              |                   |               |       | next business day           | scanner result or publication state   |
| x402all               |                   |               |       | +24 hours                   | category, price, and route accuracy   |
| x402 List             |                   |               |       | within stated review window | health probe and listing state        |
| Glama                 |                   |               |       | +7 days                     | package and connection metadata       |
| PulseMCP              |                   |               |       | +7 days                     | listing state                         |
| mcp.so                |                   |               |       | +7 days                     | free-review state                     |
| Claude Connectors     |                   |               |       | review-dependent            | reviewer response                     |

Track first MCP connection, paid call, completed render, settled transaction, and `failed_not_charged` separately. A channel is successful only when it produces a completed paid QC-passed render or a durable integration, not merely a backlink.

## 6. Captain-owned gates

1. **Settlement approval**: the command in section 3.1 moves 0.25 real USDC. It must not be run until the Captain approves that spend.
2. **npm publication**: `musicwire-mcp` remains unpublished until the held npm credential task finishes.
3. **Privacy policy**: no policy URL exists. A policy must be selected and published before remote MCP directory review, especially Claude Connectors.
4. **Remote MCP transport**: shipped. The hosted Streamable HTTP endpoint is `POST /mcp` at `https://musicwire.5432wire.com/mcp`, advertised in `mcp/server.json` remotes. Remote-MCP listings may proceed once that endpoint is deployed and answering in production.
5. **Contact email and accounts**: use Captain-owned contact details and accounts for all forms. Do not create an account solely for this packet.
