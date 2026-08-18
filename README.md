# Musicwire

Musicwire is a deterministic MusicXML validation, MuseScore rendering, automated QC, and attribution API for agents. It does not compose music or invoke a server-side LLM. MCP clients such as Claude Code and Cursor can use the API through the `musicwire-mcp` stdio server in `mcp/`; see `mcp/README.md` for install, configuration, and payment behavior.

## Agent quickstart

Get a static MusicXML authoring prompt and quality bar at no cost:

```sh
curl 'http://localhost:8787/v1/compose-guide?style=waltz&key=F%20major&tempo=84'
```

Request a validation quote before rendering. The response is `402 Payment Required` until an x402 buyer supplies a valid Base Sepolia payment authorization:

```sh
curl -X POST http://localhost:8787/v1/validate \
  -H 'content-type: application/json' \
  --data '{"musicxml":"<?xml version=\"1.0\"?><score-partwise version=\"4.0\">...</score-partwise>"}'
```

Submit an asynchronous render. MusicXML, `NOTICE.txt`, and `receipt.json` are always returned. `svg` and `png` results are page sets.

```sh
curl -X POST http://localhost:8787/v1/render \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: a-stable-request-id' \
  --data @request.json

# request.json: {"musicxml":"...","formats":["pdf","svg","mp3"],"constraints_check":{"tempo":84}}
# Poll the returned job_id without charge:
curl http://localhost:8787/v1/jobs/JOB_ID
```

`POST /v1/validate` accepts raw `application/xml` bytes or a JSON `musicxml` string. `POST /v1/render` requires JSON with a non-empty `formats` array and accepts optional `constraints_check`. Client filesystem paths and compressed input are rejected.

## How agents pay

Musicwire Phase 2 accepts **test USDC on Base Sepolia only** (`eip155:84532`). Do not send mainnet funds. The receiving CDP Server Wallet is `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`.

Run a payment-enabled server by sourcing local CDP credentials without printing them. The durable local database stores only the named wallet identity and receiving address, never the wallet secret.

```sh
set -a
. "$HOME/.config/ai-keys.env"
set +a
MUSICWIRE_PAYMENT_MODE=x402 \
MUSICWIRE_PUBLIC_BASE_URL='https://musicwire.example' \
ARTIFACT_SIGNING_SECRET='replace-with-a-long-random-secret' \
npm start
```

The following `curl` request is the discovery step. It returns the exact `Payment-Required` header and JSON quote, including the output schema, with no payment authorization or settlement.

```sh
export MUSICWIRE_URL='https://musicwire.example'
curl -sS -D /tmp/musicwire-402.headers -o /tmp/musicwire-402.json \
  -X POST "$MUSICWIRE_URL/v1/render" \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: agent-render-001' \
  --data-binary @request.json
```

For Coinbase Agentic Wallet CLI, fund its Base Sepolia wallet with test USDC, authenticate Awal, inspect the quote, then send the identical JSON request. The `max-amount` guard is in USDC atomic units.

```sh
REQUEST_JSON="$(tr -d '\n' < request.json)"
npx awal x402 details "$MUSICWIRE_URL/v1/render" -X POST
npx awal x402 pay "$MUSICWIRE_URL/v1/render" \
  -X POST \
  -d "$REQUEST_JSON" \
  -h '{"content-type":"application/json","Idempotency-Key":"agent-render-001"}' \
  --max-amount 250000 \
  --json
```

`@x402/fetch` is the programmatic buyer used by the Base Sepolia E2E test. Set `MUSICWIRE_X402_E2E=1`, fund the named `musicwire-x402-e2e-buyer` account with at least 0.25 test USDC, then run `npm run test:x402-e2e`.

For the independent Rust client, use a throwaway Base Sepolia key only:

```sh
X402_PRIVATE_KEY="$TESTNET_PRIVATE_KEY" x402curl --x402-rpc-url https://sepolia.base.org -X POST -H 'content-type: application/json' --data-binary @request.json "$MUSICWIRE_URL/v1/render"
```

Compatibility note: `x402curl 0.2.0` was installed and tested. It receives the v2 quote and signs the retry, but that v2 signed retry does not complete with the CDP facilitator, so no job or settlement is reached. The Coinbase `@x402/fetch` E2E is the required payment proof for this phase.

An `Idempotency-Key` header on `POST /v1/validate` or `POST /v1/render` replays the original paid outcome for 24 hours and cannot create a second charge. Musicwire verifies an authorization before work begins, then calls the facilitator settlement endpoint only after server-side QC passes. A QC failure returns `failed_not_charged` and a receipt with `tx_hash: null`. Before every settle attempt Musicwire durably records the payment as `settlement_pending` alongside the QC-passed artifacts, so a crash mid-settlement resumes as reconciliation on restart instead of a false `failed_not_charged`. If the facilitator settlement outcome is unknown after QC passes, the result is delivered with `payment.status: "settlement_pending"` and `tx_hash: null`, and Musicwire retries the settlement check in the background until it is confirmed or definitively failed; the EIP-3009 authorization nonce makes a reconciliation retry unable to charge twice. When a reconciliation retry is refused by the facilitator, Musicwire checks ground truth on Base Sepolia (`X402_RPC_URL`, default `https://sepolia.base.org`): a consumed authorization resolves to `settled` with the located transaction hash, an authorization provably unused past its expiry resolves to `failed_not_charged`, and anything else stays `settlement_pending`. A definitive facilitator refusal on `POST /v1/validate` returns `502 payment_settlement_failed` with no charge. An unpaid or invalid `POST /v1/render` returns a coarse 422 without line-level diagnostics; those are the paid `POST /v1/validate` product.

## Request and response schemas

MusicXML supplied in a JSON request body must be a UTF-8 string. Render requests must be JSON and name at least one requested artifact format.

```json
// POST /v1/validate
{ "musicxml": "<score-partwise version=\"4.0\">...</score-partwise>" }

// 402 payment quote (also represented in the Payment-Required header)
{ "x402Version": 2, "accepts": [{ "scheme": "exact", "network": "eip155:84532", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "amount": "250000", "payTo": "0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f" }], "quote": { "currency": "USDC", "price_usd": "0.25", "settlement": "after_qc_pass", "output_schema": { "completed_job_fields": ["qc", "artifacts", "receipt"] } } }

// 200 validation response after QC and settlement
{ "valid": true, "errors": [], "price_usd": "0.10", "payment": { "status": "settled" }, "receipt": { "tx_hash": "0x...", "amount_usd": "0.10", "amount_atomic": "100000", "network": "eip155:84532" } }

// POST /v1/render
{ "musicxml": "<score-partwise version=\"4.0\">...</score-partwise>", "formats": ["pdf", "svg", "mp3"], "constraints_check": { "tempo": 84, "duration_seconds": 30, "key_fifths": -1, "mode": "minor" } }

// 202 render response. The verified authorization is not yet settled.
{ "job_id": "uuid", "status": "queued", "estimated_seconds": 30, "price_usd": "0.25", "payment": { "status": "verified_pending_qc", "capture_policy": "capture_only_after_qc_pass" }, "poll_url": "/v1/jobs/uuid" }

// GET /v1/jobs/{id}
{ "job_id": "uuid", "status": "completed", "facts": { "partCount": 1, "tempo": 84, "key": { "fifths": -1, "mode": "minor" }, "scoreDurationSeconds": 30 }, "qc": { "status": "passed" }, "error": null, "payment": { "status": "settled" }, "receipt": { "status": "settled", "tx_hash": "0x...", "amount_usd": "0.25", "amount_atomic": "250000", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "network": "eip155:84532", "pay_to": "0x2855..." }, "expires_at": "2026-01-01T00:00:00.000Z", "artifacts": [{ "name": "receipt.json", "sha256": "hex", "bytes": 1234, "url": "/v1/artifacts/uuid/receipt.json?expires=...&token=..." }] }

// Error envelope: 400, 413, 415, 422, or 429 as appropriate
{ "error": { "code": "invalid_formats", "message": "..." } }
```

Artifact URLs are signed, expire with the job retention window, and return the named binary artifact. Failed render jobs use `status: "failed_not_charged"` and include a typed `error` plus `payment.status: "failed_not_charged"`. Job and validation responses expose only payment status and receipt data, never the signed payment authorization.

## API contract

| Endpoint                             |                      Price | Result                                                  |
| ------------------------------------ | -------------------------: | ------------------------------------------------------- |
| `GET /v1/compose-guide`              |                       Free | Static, versioned BYO-LLM authoring guide.              |
| `POST /v1/validate`                  |                      $0.10 | `{valid, errors:[{line, measure, message, fix_hint}]}`. |
| `POST /v1/render`                    | $0.25 solo, $0.50 ensemble | Returns `job_id` and `estimated_seconds`.               |
| `GET /v1/jobs/{id}`                  |                       Free | Status, QC outcome, receipt, and signed artifact URLs.  |
| `GET /manifest`, `/.well-known/x402` |                       Free | Machine-readable service and payment requirements.      |
| `GET /health`                        |                       Free | Renderer readiness.                                     |

The configured part boundary defaults to one part. MusicXML is the source of truth and is retained with every completed render. Requestable formats are `mscz`, `pdf`, `svg`, `png`, `midi`, `mp3`, and `wav`.

Jobs are `queued`, `running`, `completed`, or `failed_not_charged`. Payment statuses are `verified_pending_qc`, `settled`, `settlement_pending`, or `failed_not_charged`. A charge capture is structurally impossible until QC passes. Payment requirements use x402 Exact USDC through the CDP facilitator on Base Sepolia. `GET /.well-known/x402` serves the machine-readable payment description and receiving address.

QC passes only when MusicXML validates, MuseScore exits successfully, every requested artifact exists, requested audio has a valid container, non-silent RMS, and score-duration agreement within 10%, with a bounded two-second natural release-tail allowance, and optional key, tempo, and duration constraints match. Failures return a typed catalogued error and are not charged.

## Run locally

Requires Node 22.5+, MuseScore Studio 4, and `ffmpeg`/`ffprobe` for audio QC. On Apple silicon, point `MSCORE_BIN` to the app binary and leave `MSCORE_ARCH=arm64`.

```sh
npm install --ignore-scripts
MSCORE_BIN='/Applications/MuseScore 4.app/Contents/MacOS/mscore' \
MSCORE_ARCH=arm64 \
FFPROBE_BIN=ffprobe \
FFMPEG_BIN=ffmpeg \
ARTIFACT_SIGNING_SECRET='replace-with-a-long-random-secret' \
npm start
```

The data directory is configurable with `MUSICWIRE_DATA_DIR` and contains the SQLite job store, the durable public receiving-wallet identity, and content-addressed artifacts. Completed artifacts are retained for at least 30 days by default.

Run automated tests:

```sh
npm test
MUSICWIRE_E2E=1 MSCORE_BIN='/Applications/MuseScore 4.app/Contents/MacOS/mscore' npm run test:e2e
MUSICWIRE_X402_E2E=1 MSCORE_BIN='/Applications/MuseScore 4.app/Contents/MacOS/mscore' npm run test:x402-e2e
```

The end-to-end test skips cleanly where MuseScore is absent. It renders a real score locally when enabled.

## Container deployment

The image pins the official MuseScore Studio 4.7.2 AppImage, runs it under Xvfb, and includes ffmpeg/ffprobe. It provides deployment parity. The image sets `NODE_ENV=production`; the startup guards in `src/config.js` are authoritative and refuse a production boot without `MUSICWIRE_PAYMENT_MODE=x402` and `CDP_WALLET_SECRET`.

`compose.yaml` defines two services:

- `musicwire` (the default for `docker compose up`) is a clearly labeled non-production local test service. It overrides `NODE_ENV=test` and pins `MUSICWIRE_PAYMENT_MODE=stub`, so it needs no CDP credentials and can never reach the facilitator or settle on-chain.
- `musicwire-production` (compose profile `production`) keeps the image's `NODE_ENV=production`, sets `MUSICWIRE_PAYMENT_MODE=x402`, and passes `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, and `MUSICWIRE_PUBLIC_BASE_URL` through from the host environment (or an uncommitted `env_file` you add locally). The startup guards refuse a production boot without `CDP_WALLET_SECRET`, so a true production run starts only when the operator supplies real credentials. No secret is committed to the repository and production never defaults to stub.

```sh
docker build -t musicwire .

# Non-production local test service (stub payments, no credentials):
ARTIFACT_SIGNING_SECRET='replace-with-a-long-random-secret' docker compose up

# Production service; source real CDP credentials first, never commit them:
set -a
. "$HOME/.config/ai-keys.env"
set +a
ARTIFACT_SIGNING_SECRET='replace-with-a-long-random-secret' \
MUSICWIRE_PUBLIC_BASE_URL='https://musicwire.example' \
docker compose up musicwire-production
```

The full published-port container rendering smoke test remains a deploy-phase follow-up because Docker Desktop reset loopback connections during the initial probe; the native MuseScore E2E remains the pipeline proof for this phase.

## Rights, attribution, and acceptable use

Each completed render includes `NOTICE.txt` containing the installed MS Basic license and FluidR3, Michael Cowgill, and S. Christian Collins attribution. `receipt.json` includes the renderer version, sound profile, soundfont SHA-256 where configured, `rendered_by: "Musicwire"`, and this repository URL.

Customers own their compositions. Audio can be used commercially when the NOTICE travels with it. Musicwire sells a render and QC service and never sells copyright in a composition. Only the pinned MS Basic soundfont is supported. Custom soundfonts, plugins, external XML entities, and copyrighted-melody transcription are prohibited. The renderer performs no intentional network operations; strict egress control is a deploy-phase follow-up, and any future network use must be limited to music-request processing, never general browsing.

## Operational tradeoffs

Idempotency keys replay the original job without comparing request bodies for 24 hours. Artifact retention is a 30-day minimum without an automated purge job, so deployments must provision storage and add cleanup policy before long-term operation.
