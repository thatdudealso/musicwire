# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Runtime architecture and API contract are documented in `README.md`; configuration defaults are authoritative in `src/config.js`.
- Run `npm test` for unit coverage. Set `MUSICWIRE_E2E=1` and `MSCORE_BIN` to run the real native MuseScore end-to-end test in `test/e2e.test.js`. `npm run test:x402-e2e` (`MUSICWIRE_X402_E2E=1`) runs the real Base Sepolia x402 buyer E2E in `test/x402-e2e.test.js`; it needs local CDP credentials and a funded test-USDC buyer, and it moves testnet funds.
- Run `npm run lint` (ESLint flat config) and `npm run format:check` (Prettier) before pushing; `npm run format` applies formatting.
- The Docker image is pinned to MuseScore Studio 4.7.2 and builds locally. Published-port container E2E is a deploy-phase follow-up because Docker Desktop reset loopback connections during the initial probe.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
