# Musicwire

Musicwire is a deterministic MusicXML validation, MuseScore rendering, automated QC, and attribution API for agents. It does not compose music or invoke a server-side LLM. MCP clients such as Claude Code and Cursor can use the API through the `musicwire-mcp` stdio server in `mcp/`. Hosted MCP clients use Streamable HTTP at `POST /mcp` on the same service. See `mcp/README.md` for install, configuration, and payment behavior.

## Agent quickstart

Get a static MusicXML authoring prompt and quality bar at no cost:

```sh
curl 'http://localhost:8787/v1/compose-guide?style=waltz&key=F%20major&tempo=84'
```

Request a validation quote before rendering. The response is `402 Payment Required` until an x402 buyer supplies a payment authorization valid for the network this deployment advertises (Base Sepolia by default, Base mainnet in production):

```sh
curl -X POST http://localhost:8787/v1/validate \
  -H 'content-type: application/json' \
  --data '{"musicxml":"<?xml version=\"1.0\"?><score-partwise version=\"4.0\">...</score-partwise>"}'
```

Submit an asynchronous render. Request MP3 for a human to listen to and MIDI for an agent or musician to edit. MusicXML, `NOTICE.txt`, and `receipt.json` are always returned.

```sh
curl -X POST http://localhost:8787/v1/render \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: a-stable-request-id' \
  --data @request.json

# request.json: {"musicxml":"...","formats":["mp3","midi"],"constraints_check":{"tempo":84}}
# Poll the returned job_id without charge:
curl http://localhost:8787/v1/jobs/JOB_ID
```

`POST /v1/validate` accepts raw `application/xml` bytes or a JSON `musicxml` string. `POST /v1/render` requires JSON with a non-empty `formats` array and accepts optional `constraints_check`. Client filesystem paths and compressed input are rejected.

## How agents pay

Local and stub x402 runs default to **test USDC on Base Sepolia** (`eip155:84532`). The production deployment is pinned to **Base mainnet** (`eip155:8453`) and creates or reuses its named CDP Server Wallet from the supplied credentials. Do not send funds to a local or test deployment.

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

### Paying successfully

To pay, a buyer must (1) hold at least the quoted price in the **advertised network's** USDC in a wallet it controls, and (2) present an EIP-3009 payment authorization for that quote in a `Payment-Signature` header. Musicwire verifies the authorization with the CDP facilitator before doing any work, and settles only after server-side QC passes. Both externally-owned (private-key) wallets and Coinbase managed smart-contract wallets settle through this flow.

Fund the buyer on whichever network the quote names. Production advertises Base mainnet (`eip155:8453`) and native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; local and stub runs advertise Base Sepolia test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. The receiving wallet and chain are fixed by the deployment; do not send funds to a local or test deployment.

Read the response status to know what to do next:

- `202` (render) or `200` (validate): payment verified; poll the `job_id` (free) until `completed` or `failed_not_charged`.
- `402` with a JSON `error` field: verification returned a determinate reason. The `error` states exactly what to fix (for example `insufficient_funds`, `invalid_payload`, an expired authorization window, or `invalid_exact_evm_nonce_already_used` for a replayed nonce). Correct it and retry with a fresh authorization.
- `503 payment_verification_unavailable`: verification could not be completed (network or facilitator problem). This is **not** a refusal and **no** payment was attempted; retry later.

#### For humans (Coinbase Agentic Wallet, interactive)

1. Install and sign in with an email one-time code:
   ```sh
   npx awal auth login you@example.com
   npx awal auth verify <flow-id> <code-from-email>
   ```
2. Fund the awal wallet with at least the quoted price in USDC on the advertised network, and confirm the balance:
   ```sh
   npx awal balance --json
   ```
3. Inspect the quote, then pay the identical request body. `--max-amount` is a guard in USDC atomic units (`250000` = $0.25):
   ```sh
   export MUSICWIRE_URL='https://musicwire.example'
   REQUEST_JSON="$(tr -d '\n' < request.json)"
   npx awal x402 details "$MUSICWIRE_URL/v1/render" -X POST
   npx awal x402 pay "$MUSICWIRE_URL/v1/render" \
     -X POST \
     -d "$REQUEST_JSON" \
     -h '{"content-type":"application/json","Idempotency-Key":"agent-render-001"}' \
     --max-amount 250000 \
     --json
   ```
4. Poll the returned `job_id` until `status` is `completed` (artifacts and a settled `receipt.tx_hash`) or `failed_not_charged`.

#### For agents (programmatic, non-interactive)

Coinbase `@x402/fetch` with a CDP-backed signer is the reference buyer and the client the automated E2E proof uses. Provision the wallet, fund the returned address with at least the quoted price in the advertised network's USDC, then let `@x402/fetch` handle the 402 retry:

```js
import { CdpX402Client } from '@coinbase/cdp-sdk/x402';
import { wrapFetchWithPayment } from '@x402/fetch';

// environment: 'production' (the default when omitted) -> Base mainnet; set 'development' explicitly for Base Sepolia (local or stub servers).
const client = new CdpX402Client({
  environment: 'production',
  walletConfig: { type: 'eoa', accountName: 'my-buyer' },
});
const { evmAddress } = await client.getAddresses(); // fund this address with USDC first
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay(`${process.env.MUSICWIRE_URL}/v1/render`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'Idempotency-Key': 'agent-render-001' },
  body: JSON.stringify({ musicxml, formats: ['mp3', 'midi'] }),
});
// 202 -> poll (await res.json()).job_id ; 402 -> read (await res.json()).error for the exact reason.
```

The automated settlement proof runs this client on Base Sepolia: set `MUSICWIRE_X402_E2E=1`, fund the named `musicwire-x402-e2e-buyer` account with at least 0.25 test USDC, then run `npm run test:x402-e2e`.

The independent Rust `x402curl` client works the same way with a funded key on the advertised network:

```sh
X402_PRIVATE_KEY="$FUNDED_KEY" x402curl --x402-rpc-url https://mainnet.base.org \
  -X POST -H 'content-type: application/json' -H 'Idempotency-Key: agent-render-001' \
  --data-binary @request.json "$MUSICWIRE_URL/v1/render"
```

Compatibility note: a live payment has settled against the production deployment on Base mainnet (transaction `0x1df77f5748fc3b0ebed13bed14069dfc17ed349a670cf00216766597fffbbf84`), confirming third-party buyers - including Coinbase managed smart-contract wallets - can pay end to end. An earlier report that signed retries "never complete" was an artifact of a server bug that replaced every verification exception with a fixed "facilitator could not verify" message regardless of the real cause; that bug is fixed, so a determinate rejection now returns the facilitator's actual reason in the `402` re-challenge (for example fund the wallet, widen the validity window, or use a fresh nonce, then retry). `x402curl 0.2.0` and Coinbase `@x402/fetch` both produce structurally valid v2 payloads that reach verification, and the `@x402/fetch` Base Sepolia E2E remains the automated regression proof.

An `Idempotency-Key` header replays the original paid outcome and cannot create a second charge. A render key replays for 24 hours only when the same verified payer submits the same render request context; a validation key replays indefinitely only when the same verified payer submits the same MusicXML request context. Replay hashing sorts object keys and the unordered render `formats` selection, since format order cannot alter requested work; MusicXML and any order-sensitive input remain unchanged. A key from another payer never resolves a retained result. Musicwire verifies an authorization before work begins, then calls the facilitator settlement endpoint only after server-side QC passes. A QC failure returns `failed_not_charged` and a receipt with `tx_hash: null`. Before every settle attempt Musicwire durably records the payment as `settlement_pending` alongside the QC-passed artifacts, so a crash mid-settlement resumes as reconciliation on restart instead of a false `failed_not_charged`. If the facilitator settlement outcome is unknown after QC passes, the result is delivered with `payment.status: "settlement_pending"` and `tx_hash: null`, and Musicwire retries the settlement check in the background until it is confirmed or definitively failed; the EIP-3009 authorization nonce makes a reconciliation retry unable to charge twice. When a reconciliation retry is refused by the facilitator, Musicwire checks ground truth on the configured network (`X402_RPC_URL`, default `https://sepolia.base.org`, and `https://mainnet.base.org` in production): a consumed authorization resolves to `settled` with the located transaction hash, an authorization provably unused past its expiry resolves to `failed_not_charged`, and anything else stays `settlement_pending`. A definitive facilitator refusal on `POST /v1/validate` returns `502 payment_settlement_failed` with no charge. A request to a priced route without a `Payment-Signature` receives the `402` challenge before payload validation, even when its body is empty, missing, or malformed, so discovery probes can read the quote; payload validation and its not-charged failure codes apply only once a payment is presented, while oversized and compressed bodies are still rejected at the transport layer. A paid `POST /v1/render` with an invalid score returns a coarse 422 without charging and without line-level diagnostics; those are the paid `POST /v1/validate` product.

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
{ "musicxml": "<score-partwise version=\"4.0\">...</score-partwise>", "formats": ["mp3", "midi"], "constraints_check": { "tempo": 84, "duration_seconds": 30, "key_fifths": -1, "mode": "minor" } }

// 202 render response. The verified authorization is not yet settled.
{ "job_id": "uuid", "status": "queued", "estimated_seconds": 30, "price_usd": "0.25", "payment": { "status": "verified_pending_qc", "capture_policy": "capture_only_after_qc_pass" }, "poll_url": "/v1/jobs/uuid", "provenance": { "receipt_id": "uuid", "verification_url": "https://musicwire.example/v1/provenance/verify" } }

// GET /v1/jobs/{id}
{ "job_id": "uuid", "status": "completed", "facts": { "partCount": 1, "instruments": ["Piano"], "tempo": 84, "key": { "fifths": -1, "mode": "minor" }, "scoreDurationSeconds": 30 }, "qc": { "status": "passed" }, "error": null, "payment": { "status": "settled" }, "receipt": { "status": "settled", "tx_hash": "0x...", "amount_usd": "0.25", "amount_atomic": "250000", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "network": "eip155:84532", "pay_to": "0x2855..." }, "provenance": { "receipt_id": "uuid", "verification_url": "https://musicwire.example/v1/provenance/verify" }, "expires_at": "2026-01-01T00:00:00.000Z", "artifacts": [{ "name": "receipt.json", "sha256": "hex", "bytes": 1234, "url": "/v1/artifacts/uuid/receipt.json?expires=...&token=..." }] }

// POST /v1/provenance/verify - free, no payment required
{ "sha256": "64-character-lowercase-hex-sha-256-of-an-artifact-file" }

// 200 when the hash matches a Musicwire-rendered artifact; unknown hashes return { "rendered_by_musicwire": false }
{ "rendered_by_musicwire": true, "receipt_id": "uuid", "rendered_at": "2026-01-01T00:00:00.000Z", "artifact": { "name": "score.mp3", "sha256": "hex", "bytes": 1234 }, "receipt": { "receipt_id": "uuid", "rendered_by": "Musicwire", "verification_url": "https://musicwire.example/v1/provenance/verify", "rendered_at": "2026-01-01T00:00:00.000Z", "artifacts": [{ "name": "score.mp3", "sha256": "hex", "bytes": 1234 }], "signature": "base64url", "signature_algorithm": "HMAC-SHA-256" } }

// POST /reviews - tx_hash must be from a settled Musicwire render payment
{ "tx_hash": "0x...", "rating": 5, "comment": "Accurate output and clean artifacts." }

// 201 review response. The transaction anchor is public and independently verifiable on Base Sepolia.
{ "review": { "rating": 5, "comment": "Accurate output and clean artifacts.", "tx_hash": "0x...", "network": "eip155:84532", "created_at": "2026-01-01T00:00:00.000Z" } }

// GET /reviews?page=1&limit=20
{ "reviews": [{ "rating": 5, "comment": "Accurate output and clean artifacts.", "tx_hash": "0x...", "network": "eip155:84532", "created_at": "2026-01-01T00:00:00.000Z" }], "pagination": { "page": 1, "limit": 20, "total": 1, "total_pages": 1 } }

// Error envelope: 400, 413, 415, 422, or 429 as appropriate
{ "error": { "code": "invalid_formats", "message": "..." } }
```

Artifact URLs are signed and expire with the job retention window. A local-storage deployment streams the named binary artifact inline; an S3-backed deployment answers `302` to a short-lived presigned URL, so clients must follow redirects. Failed render jobs use `status: "failed_not_charged"` and include a typed `error` plus `payment.status: "failed_not_charged"`. Job and validation responses expose only payment status and receipt data, never the signed payment authorization.

## API contract

| Endpoint                             |                      Price | Result                                                     |
| ------------------------------------ | -------------------------: | ---------------------------------------------------------- |
| `GET /v1/compose-guide`              |                       Free | Static, versioned BYO-LLM authoring guide.                 |
| `POST /v1/validate`                  |                      $0.10 | `{valid, errors:[{line, measure, message, fix_hint}]}`.    |
| `POST /v1/render`                    | $0.25 solo, $0.50 ensemble | Returns `job_id` and `estimated_seconds`.                  |
| `GET /v1/jobs/{id}`                  |                       Free | Status, QC outcome, receipt, and signed artifact URLs.     |
| `POST /v1/provenance/verify`         |                       Free | Checks an artifact SHA-256 against signed render receipts. |
| `POST /reviews`                      |                       Free | Creates one 1-5 review for a settled render `tx_hash`.     |
| `GET /reviews`                       |                       Free | Paginated public reviews with their transaction anchors.   |
| `GET /manifest`, `/.well-known/x402` |                       Free | Machine-readable service and payment requirements.         |
| `GET /health`                        |                       Free | Renderer readiness.                                        |
| `GET /`, `GET /docs`                 |                       Free | Human-facing landing page and docs with live pricing.      |

The configured part boundary defaults to one part. MusicXML is the source of truth and is retained with every completed render. Requestable formats are `mp3` for listening and `midi` for editing.

Jobs are `queued`, `running`, `completed`, or `failed_not_charged`. Payment statuses are `verified_pending_qc`, `settled`, `settlement_pending`, or `failed_not_charged`. A charge capture is structurally impossible until QC passes. `POST /reviews` accepts a transaction hash only when it matches a settled Musicwire render and permits one review per transaction. Payment requirements use x402 Exact USDC through the CDP facilitator on the configured network: Base mainnet in production, Base Sepolia for local and stub runs. `GET /manifest` publishes that network and its human-readable label plus `review_stats.count` and `review_stats.average_rating`, and `GET /.well-known/x402` serves the machine-readable payment description and receiving address.

QC passes only when MusicXML validates, MuseScore exits successfully, every requested artifact exists, requested audio has a valid container, non-silent RMS, and score-duration agreement within 10%. MP3 exports receive a bounded three-second renderer release-tail allowance; declared sustained instruments receive up to 3.25 seconds. Musicwire derives the larger allowance from a declared `part-name` or `instrument-name`, including violin, cello, Wind, Woodwind, Brass, Strings, organ, and voice. Optional key, tempo, and duration constraints must also match. Failures return a typed catalogued error and are not charged.

## Attribution and verifiable provenance

Every rendered artifact is attributed to Musicwire at render time, after QC, in a way that never alters the audio samples or MIDI events:

| Format   | Embedded attribution                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| MP3      | ID3 tags: `encoded_by`, `comment`, and `copyright`, written by ffmpeg stream copy. |
| MIDI     | Copyright and text meta events in the first track.                                 |
| MusicXML | `software` and `encoding-description` entries in `identification/encoding`.        |

At render completion Musicwire computes each artifact's SHA-256 and signs a render receipt with an HMAC-SHA-256 key derived from `ARTIFACT_SIGNING_SECRET` (domain-separated, so the receipt key is never the artifact URL key). The receipt is stored durably alongside the job, included in `receipt.json`, and its `receipt_id` and verification URL appear in the render API response and in `NOTICE.txt`.

The honest limitation: embedded tags credit Musicwire but can be stripped by a determined party. The signed hash receipt is what proves provenance regardless, because a stripped or otherwise modified file no longer matches any recorded artifact hash.

### For humans

Keep the rendered file unmodified. To check that a file came from Musicwire, compute the file's SHA-256 hash and submit it to the free verification endpoint at `https://musicwire.5432wire.com/v1/provenance/verify`. If Musicwire rendered that exact file, the answer includes the render receipt; any edit to the file changes its hash and the check answers no.

### For agents

```sh
HASH="$(shasum -a 256 output.mp3 | cut -d' ' -f1)"
curl -s -X POST https://musicwire.5432wire.com/v1/provenance/verify \
  -H 'content-type: application/json' \
  -d "{\"sha256\":\"$HASH\"}"
```

A match returns `rendered_by_musicwire: true` with the receipt id, render time, matching artifact record, and the full signed receipt; an unknown hash returns `{ "rendered_by_musicwire": false }`. Verification is free and requires no payment.

## Run locally

Requires Node 22.5+, MuseScore Studio 4, and `ffmpeg`/`ffprobe` for audio QC and MP3 attribution. On Apple silicon, point `MSCORE_BIN` to the app binary and leave `MSCORE_ARCH=arm64`.

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

The native quality suite skips with an explicit reason where MuseScore, ffmpeg, or ffprobe is absent. When enabled it exercises the real HTTP render queue, MuseScore, MP3 and MIDI attribution, audio QC primitives, constraints, and a failed-not-charged outcome. It does not use a renderer stub.

### Native render quality evidence procedure

This procedure is local render evidence and is independent of the AWS deployment below. Run the native suite with `MUSICWIRE_E2E=1` on the release commit and retain the TAP output in the PR. The suite verifies the MP3 and MIDI artifacts, their attribution, audio container/stream/channel/sample-rate/duration/RMS properties, score facts and payment state. It also submits a deliberate constraint mismatch and records a visible `failed_not_charged` job with `receipt.tx_hash: null`.

The S3 redirect route is separately exercised with an artifact larger than 10 MB by `node --test test/artifacts.test.js`; its TAP output proves the signed redirect returns exact stored bytes outside the API payload limit. Do not treat a skipped native test as evidence - install the documented tools and rerun it before approval. For any environment where this cannot run, attach the command output and the reason to the PR before go-live.

## Container deployment

The image pins the official MuseScore Studio 4.7.2 AppImage, runs it under Xvfb, and includes ffmpeg/ffprobe. It provides deployment parity. The image sets `NODE_ENV=production`; the startup guards in `src/config.js` are authoritative and refuse a production boot without `MUSICWIRE_PAYMENT_MODE=x402`, all three CDP credentials, an explicit non-development artifact signing secret, and `X402_NETWORK=eip155:8453`.

`compose.yaml` defines two services:

- `musicwire` (the default for `docker compose up`) is a clearly labeled non-production local test service. It overrides `NODE_ENV=test` and pins `MUSICWIRE_PAYMENT_MODE=stub`, so it needs no CDP credentials and can never reach the facilitator or settle on-chain.
- `musicwire-production` (compose profile `production`) keeps the image's `NODE_ENV=production`, pins Base mainnet, and passes `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, and `MUSICWIRE_PUBLIC_BASE_URL` through from the host environment (or an uncommitted `env_file` you add locally). No secret is committed to the repository and production never defaults to stub.

Because that profile runs with `NODE_ENV=production`, it inherits the production requirement for S3 artifact storage and therefore needs AWS credentials you supply yourself - the compose file deliberately forwards none. Add them voluntarily through your own uncommitted `env_file`, or by mounting your `~/.aws` read-only into the container. No static AWS key is forwarded by default or committed anywhere in this repository, and the real deployment never uses one: on ECS the task role supplies credentials through the container credential endpoint. If you only want a local render loop, use the default `musicwire` stub service, which needs no AWS access at all.

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

### AWS production deployment

`scripts/deploy-production.sh` deploys the production service on the shared on-demand ECS Fargate cluster through the existing API Gateway VPC Link and internal NLB. It creates no new load balancer or fixed-cost infrastructure. AMD64 images are built natively on an `ubuntu-24.04` GitHub Actions runner and published to the public `ghcr.io/thatdudealso/musicwire` registry, avoiding both unreliable local ARM-to-AMD64 emulation and any AWS credential or OIDC role in CI. Dispatch the workflow with the immutable release commit SHA:

```sh
RELEASE_SHA="$(git rev-parse HEAD)"
gh-axi workflow run build-production-image.yml --repo thatdudealso/musicwire \
  --ref main --field image_tag="$RELEASE_SHA"
```

`--ref` must be a branch or tag: the workflow-dispatch API rejects a raw commit SHA, and it only selects which version of the workflow file runs. The built tree comes from `image_tag`, which must be the full 40-character release commit SHA. The workflow checks out exactly that commit and fails if the checked-out tree is not that SHA, so the published tag always names the source it was built from. The workflow authenticates with the built-in `GITHUB_TOKEN` alone and needs no AWS access. Set the published package to public visibility once so ECS can pull it without registry credentials.

GHCR does not enforce tag immutability the way an ECR repository with `IMMUTABLE` tags does, so a re-dispatch of the same SHA overwrites the tag. Immutability here is a convention backed by the workflow's SHA check: never re-dispatch a tag that has been deployed; cut a new commit instead.

#### Recorded deviation from the original intent

The Phase 4 intent asked for an immutable AMD64 **ECR** image published through a GitHub Actions workflow using least-privilege **GitHub OIDC**. This repository instead publishes to public GHCR with no AWS credentials in CI. That deviation was decided by FIRSTMATE under the captain's standing authorization; it was not chosen personally by the captain. The rationale: this is a public repository, the AWS account has no existing GitHub OIDC provider, and federating a public repository into the account is avoidable exposure for a build that needs no AWS access. No AWS credential is required in CI because every runtime secret is injected as an ECS task-definition secret from Secrets Manager. If ECS cannot pull from GHCR, the operator-machine ECR build-and-push fallback below uses local operator credentials and still creates no OIDC provider or role.

The deploy script requires the configured AWS credentials used by `aws-axi`, a readable `MUSICWIRE_SECRETS_ENV_FILE` (default: `$HOME/.config/ai-keys.env`) containing these values, and the pushed image URI:

- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `CDP_WALLET_SECRET`

It copies those credentials and an opaque `ARTIFACT_SIGNING_SECRET` into AWS Secrets Manager at deployment time. They are supplied to ECS as task-definition secrets, never plaintext environment values. For a first deployment the signing secret is generated locally without printing it; later deployments retain the existing signing secret so active artifact URLs remain valid. Run the deploy script from a clean release commit:

```sh
MUSICWIRE_IMAGE_URI="ghcr.io/thatdudealso/musicwire:$(git rev-parse HEAD)" \
  ./scripts/deploy-production.sh
```

If ECS cannot pull from GHCR, the fallback is an operator-machine AMD64 build pushed to `841162711749.dkr.ecr.us-east-1.amazonaws.com/musicwire`. The deploy script accepts that URI too, and the task execution role already carries the ECR pull permissions.

The infrastructure definition is [infra/musicwire-production.yaml](infra/musicwire-production.yaml). It creates an API Gateway HTTP API custom domain and Route53 alias at `musicwire.5432wire.com`, a dedicated listener and target group on the existing internal NLB, an encrypted S3 artifact bucket, and an encrypted EFS access point for `/var/lib/musicwire/data`. `MUSICWIRE_ARTIFACT_STORAGE=s3` is required in production and `MUSICWIRE_ARTIFACT_BUCKET` defaults to `musicwire-artifacts-841162711749`; the bucket retains content-addressed downloadable artifacts for 30 days. `GET /v1/artifacts/:jobId/:name` validates the existing signed token first and only then answers `302` with a short-lived presigned S3 URL (`MUSICWIRE_ARTIFACT_URL_TTL_SECONDS`, default 900, capped at one hour). The bucket stays private with public access fully blocked - the presigned URL is the only way bytes leave it. Redirecting rather than proxying also keeps downloads clear of the API Gateway 10 MB payload quota, which a large multi-page or long-audio render would otherwise exceed. ECS Fargate injects no region of its own, so the task definition sets `AWS_REGION` and the production startup guards refuse to boot S3 artifact storage without one. The task role carries `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on `artifacts/*` plus `s3:ListBucket` scoped to that prefix; without `ListBucket`, S3 answers `403 AccessDenied` instead of `404 NoSuchKey` for a key the lifecycle rule removed, which would report permanently expired artifacts as a retryable 503. ECS supplies these credentials through the task-role container credential endpoint - no static AWS key is ever set, forwarded, or committed.

`X402_RPC_URL` defaults to the RPC endpoint of the configured network, and `src/server.js` calls `eth_chainId` on it before binding a port, refusing to start production unless the chain it serves matches `X402_NETWORK`. That check is authoritative and fail-closed: a wrong-chain, unreachable, or non-responsive endpoint stops the boot rather than silently stranding settlements in `settlement_pending`. Every JSON-RPC request carries a bounded timeout (`X402_RPC_TIMEOUT_SECONDS`, default 10) so a half-open endpoint fails the boot inside the container health-check start period instead of hanging it.

#### Data retention

The 30-day lifecycle rule applies only to rendered artifact objects in S3. Nothing prunes payment-bearing state: `jobs`, `payment_wallets`, `payment_authorizations`, and `validate_results` rows are retained indefinitely on EFS, so a payment, settlement, or receipt record always outlives the artifact it paid for and artifact expiry can never destroy payment proof. A settled `POST /v1/validate` writes its only durable charge record into `validate_results`, so that table in particular is never swept. `expireIdempotencyKeys()` deletes from `idempotency_keys` alone. Any future data-retention or privacy policy that would delete these records is a captain decision, not a maintenance change.

SQLite is opened with `journal_mode = TRUNCATE` and `synchronous = FULL`, because write-ahead logging is unsupported on an NFS-backed EFS mount and a non-synchronous commit is not durable across a killed task. The database on EFS durably preserves the `jobs`, `idempotency_keys`, `payment_wallets`, `payment_authorizations`, and `validate_results` tables, including payment and settlement JSON. On restart, `JobStore.recoverInterruptedJobs()` marks a queued or running render `failed_not_charged` with `render_interrupted`, while completed jobs and their S3 artifacts remain available. This design is intentionally limited to one task: the ECS deployment maximum is also one task, so do not scale Musicwire above one task without replacing SQLite-over-EFS with a multi-writer-safe design.

To verify replacement recovery after a completed paid render, retain its `job_id`, run a forced ECS deployment, wait for the task to become healthy, then fetch the job and one signed artifact URL again. The job, payment receipt, and artifact must remain available; an in-flight job must instead become the visible `failed_not_charged` recovery outcome.

```sh
npx -y aws-axi ecs update-service --cluster 5432wire-cluster --service musicwire \
  --force-new-deployment --region us-east-1
curl -sS "https://musicwire.5432wire.com/v1/jobs/$JOB_ID"
curl -sS -L "$SIGNED_ARTIFACT_URL" -o /dev/null
```

## Rights, attribution, and acceptable use

Each completed render includes `NOTICE.txt` containing the installed MS Basic license and FluidR3, Michael Cowgill, and S. Christian Collins attribution, plus the render receipt id and the free provenance verification URL. `receipt.json` includes the renderer version, sound profile, soundfont SHA-256 where configured, `rendered_by: "Musicwire"`, this repository URL, and the signed provenance receipt.

Customers own their compositions. Audio can be used commercially when the NOTICE travels with it. Musicwire sells a render and QC service and never sells copyright in a composition. Only the pinned MS Basic soundfont is supported. Custom soundfonts, plugins, external XML entities, and copyrighted-melody transcription are prohibited. The renderer performs no intentional network operations; strict egress control is a deploy-phase follow-up, and any future network use must be limited to music-request processing, never general browsing.

## Operational tradeoffs

Render idempotency keys replay for 24 hours only for the same verified payer and request context; validation keys retain the same payer and MusicXML context indefinitely. Production S3 artifact objects expire on a 30-day lifecycle rule, but a local-storage deployment has a 30-day retention minimum with no automated purge job, so it must provision storage and add a cleanup policy before long-term operation.
