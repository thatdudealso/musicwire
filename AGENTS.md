# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Runtime architecture and API contract are documented in `README.md`; configuration defaults are authoritative in `src/config.js`.
- The independently publishable stdio MCP package is in `mcp/`; its scripted stub-payment MCP integration test is `test/mcp-e2e.test.js`.
- Static landing page and docs are served from `static/` directory by Express routes (`/` and `/docs`) with manifest-driven dynamic pricing.
- Run `npm test` for unit coverage; its `pretest` step installs `mcp/` dependencies, which `test/mcp-e2e.test.js` needs to spawn the MCP server. Set `MUSICWIRE_E2E=1` and `MSCORE_BIN` to run the real native MuseScore end-to-end test in `test/e2e.test.js`. `npm run test:x402-e2e` (`MUSICWIRE_X402_E2E=1`) runs the real Base Sepolia x402 buyer E2E in `test/x402-e2e.test.js`; it needs local CDP credentials and a funded test-USDC buyer, and it moves testnet funds.
- Run `npm run lint` (ESLint flat config) and `npm run format:check` (Prettier) before pushing; `npm run format` applies formatting.
- The Docker image is pinned to MuseScore Studio 4.7.2. Local ARM64 builds remain supported; production AMD64 images are built by GitHub Actions because local cross-architecture AppImage extraction is unreliable. Published-port container E2E is a deploy-phase follow-up because Docker Desktop reset loopback connections during the initial probe.
- Production infrastructure is defined in `infra/musicwire-production.yaml`; `.github/workflows/build-production-image.yml` publishes the immutable native AMD64 image to public `ghcr.io/thatdudealso/musicwire` with no AWS credentials, and `scripts/deploy-production.sh` deploys that image to on-demand ECS Fargate through the shared API Gateway VPC Link and internal NLB. An operator-pushed ECR image is the accepted fallback only if ECS cannot pull GHCR. Production artifacts are content-addressed S3 objects and the SQLite data directory is an EFS access point, preserving the `jobs`, `idempotency_keys`, `payment_wallets`, `payment_authorizations`, and `validate_results` tables across task replacement. WAL is unusable on that NFS mount, so `src/store.js` pins `journal_mode = TRUNCATE` with `synchronous = FULL`. This is deliberately a single-task service - both desired count and deployment maximum are 1 - so do not scale it without replacing SQLite-over-EFS with a multi-writer-safe store.
- Retention is asymmetric on purpose: the 30-day S3 lifecycle rule expires rendered artifact objects only, while job, payment wallet, payment authorization, and validation/settlement rows are kept indefinitely on EFS so artifact expiry can never destroy payment proof. Do not add a sweep that deletes those rows; `expireIdempotencyKeys()` ages out replay-protection keys only. Changing this retention or adding a privacy policy is a captain decision, not a maintenance change.
- Production boot is fail-closed on chain identity: `src/server.js` calls `verifyRpcNetwork` (`src/payment.js`) to confirm `eth_chainId` from `X402_RPC_URL` matches `X402_NETWORK` before binding a port. Keep that check ahead of `createApp()`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
