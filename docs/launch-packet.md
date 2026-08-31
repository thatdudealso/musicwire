# Musicwire listing and registry launch packet

Truth pass 2026-08-30. This packet records what is live, what this worker submitted, and the exact remaining captain-owned steps. It does not authorize invented accounts, paid placements, or the open `xpaysh/awesome-x402` PR #1304.

Canonical one-line (use verbatim):

> Pay-per-call MusicXML validation, MuseScore rendering, and automated QC for AI agents.

Longer description:

> Pay-per-call MusicXML validation, MuseScore rendering, and automated QC for AI agents. Musicwire returns actionable score errors, MP3 audio for listening, and MIDI for editing, and charges only after QC passes.

Do not describe Musicwire as a composition model. Formats are MP3 and MIDI only.

## 1. Canonical record

| Field                  | Value                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Product                | Musicwire                                                                                               |
| Landing                | https://musicwire.5432wire.com                                                                          |
| Docs + 9-track gallery | https://musicwire.5432wire.com/docs (live)                                                              |
| Health                 | https://musicwire.5432wire.com/health                                                                   |
| API manifest           | https://musicwire.5432wire.com/manifest                                                                 |
| x402 description       | https://musicwire.5432wire.com/.well-known/x402                                                         |
| Hosted MCP             | `POST https://musicwire.5432wire.com/mcp` (Streamable HTTP; `initialize` returns `musicwire-mcp` 0.1.2) |
| stdio MCP              | `npx -y musicwire-mcp` (`musicwire-mcp@0.1.1`)                                                          |
| Official MCP Registry  | `io.github.thatdudealso/musicwire-mcp` (active since 2026-08-24)                                        |
| Repository             | https://github.com/thatdudealso/musicwire                                                               |
| Support                | https://github.com/thatdudealso/musicwire/issues                                                        |
| Logo                   | https://musicwire.5432wire.com/musicwire-mark.svg                                                       |
| Contact email          | ashishyocool@gmail.com                                                                                  |
| Network                | Base mainnet, `eip155:8453`                                                                             |
| Asset                  | USDC, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                                                      |
| Receiving address      | `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`                                                            |
| Payment                | x402 Exact USDC via CDP facilitator; capture only after QC passes                                       |
| Pricing                | validate $0.10; render $0.25 solo / $0.50 ensemble                                                      |
| Provenance             | `POST /v1/provenance/verify` (free)                                                                     |
| Privacy policy         | **missing** (`GET /privacy` is 404)                                                                     |

Live verify (2026-08-30): the hosted Streamable HTTP endpoint at `POST https://musicwire.5432wire.com/mcp` is live in production (`initialize` HTTP 200, server `musicwire-mcp` 0.1.2). Docs gallery present with inline players. npm stdio package remains `musicwire-mcp@0.1.1` with `mcpName` set. Official Registry status `active`. Remote listings (Smithery, Claude Connectors, IDE connectors) must use that `/mcp` URL, not the site root. The hosted endpoint does not hold a buyer wallet; paid tools still settle x402 Exact USDC on Base inside the tool call.

Do not disclose infrastructure internals (buckets, containers, internal hosts) in any listing.

## 2. Status at a glance

| Target                                          | Status                                                | Notes                                                                                                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm `musicwire-mcp`                             | **live**                                              | 0.1.1 remains published. The source package is prepared as 0.1.3; a captain must publish it.                                                                                                                          |
| Official MCP Registry                           | **live**                                              | `io.github.thatdudealso/musicwire-mcp` 0.1.1, published 2026-08-24. Re-publish 0.1.3 through OIDC workflow 341643876 after the npm publish.                                                                           |
| Hosted MCP `/mcp`                               | **live**                                              | `POST https://musicwire.5432wire.com/mcp` (Streamable HTTP) is live in production. Use this URL for Smithery, Claude Connectors, and any remote-connector listing. Do not enter the site root as an MCP URL.          |
| 9-track docs gallery                            | **live**                                              | https://musicwire.5432wire.com/docs                                                                                                                                                                                   |
| Repo homepage + topics                          | **done**                                              | Homepage set. Topics: `mcp`, `musescore`, `musicxml`, `x402`, `usdc`, `base`, `ai-agents`, `agent-payments`, `api`, `music-generation`.                                                                               |
| CDP Bazaar                                      | **reachable via x402 discovery**                      | No separate registration form. Manifest has `payment.discovery.bazaar.discoverable: true`.                                                                                                                            |
| agent402.tools                                  | **listed**                                            | `POST /api/index/register` with origin `https://musicwire.5432wire.com` returned `listed=true`, `toolCount=1`, `networks=["eip155:8453"]`, `routable=true`, `health=1`.                                               |
| x402-list.com (hyphen)                          | **approved**                                          | Musicwire's listing was approved on 2026-08-31.                                                                                                                                                                      |
| mcp.directory                                   | **submitted, pending review**                         | `POST https://mcp.directory/api/submit-server` HTTP 200 `{ok:true}`. They claim publish within 24h. Description max 100 chars. Email for claim if auto-discovered: the form says email them (obfuscated on the page). |
| mcp.so free queue                               | **submitted**                                         | Paid $39 submit skipped. Free path is a comment on `chatmcp/mcpso` issue #1: https://github.com/chatmcp/mcpso/issues/1#issuecomment-5472062662                                                                        |
| Cline Marketplace                               | **submitted**                                         | https://github.com/cline/mcp-marketplace/issues/2368 . Did not falsely claim Cline IDE testing. Label `server-submission` could not be applied (not visible to this token).                                           |
| PulseMCP                                        | **blocked on their pause + ingest lag**               | `/submit` still says submissions paused until mid-August (checked 2026-08-30). They ingest Official Registry daily and process weekly. Email `hello@pulsemcp.com`. Not listed yet. No public write API.               |
| Smithery                                        | **blocked on captain account**                        | Immediate priority. Deploy the hosted MCP metadata, then re-publish the URL with its explicit empty config schema. See section 4.                                                                                     |
| Claude Connectors Directory                     | **blocked on captain account + product gaps**         | Immediate priority after Smithery. See section 5. Several hard blockers besides login.                                                                                                                                |
| x402all / axon402                               | **blocked on captain account; register API not live** | See section 6.                                                                                                                                                                                                        |
| Glama                                           | **claim-needed, account-gated**                       | Prior work reported auto-index. Named URLs `@thatdudealso/musicwire` and `thatdudealso/musicwire` 404 as of 2026-08-30. Add Connector / claim require sign-in. Do not redo.                                           |
| GitHub MCP Registry / VS Code `@mcp`            | **not automatic**                                     | Official Registry is upstream data. The GitHub MCP Registry that VS Code Copilot `@mcp` reads is a curated subset. After Official Registry, email `partnerships@github.com` to request inclusion.                     |
| cursor.directory plugins                        | **blocked on GitHub/Google sign-in**                  | https://cursor.directory/plugins/new                                                                                                                                                                                  |
| Goose extensions directory                      | **consumes PulseMCP**                                 | No separate public listing PR. Users add stdio or Streamable HTTP themselves.                                                                                                                                         |
| Continue Hub                                    | **account-gated**                                     | Users can still add YAML locally.                                                                                                                                                                                     |
| Windsurf marketplace                            | **no free public API/PR found**                       | Users add `mcp_config.json`. Often also via Smithery once published.                                                                                                                                                  |
| OpenAI Codex plugin portal / ChatGPT connectors | **account-gated**                                     | Users add `~/.codex/config.toml`. Privacy policy required for directory review.                                                                                                                                       |
| `xpaysh/awesome-x402` PR #1304                  | **do not touch**                                      | Separate captain decision.                                                                                                                                                                                            |
| x402list.com (no hyphen)                        | **dead end**                                          | Parked domain, not a directory. Skip.                                                                                                                                                                                 |

## 3. What this pass executed

Free, non-account-gated submissions only.

1. **agent402.tools** - origin registered, `listed=true`.
2. **x402-list.com** - Musicwire's listing was approved on 2026-08-31.
3. **mcp.directory** - `POST /api/submit-server` with GitHub URL, npm `musicwire-mcp`, 86-char description, email `ashishyocool@gmail.com`. Response: `{"ok":true,"message":"Server submitted for review!"}`.
4. **mcp.so** - comment on https://github.com/chatmcp/mcpso/issues/1#issuecomment-5472062662 .
5. **Cline Marketplace** - https://github.com/cline/mcp-marketplace/issues/2368 .

Not executed (account, paid, policy, or missing live API): Smithery, Claude Connectors, PulseMCP write, mcp.so $39, x402all `/api/register` (404), cursor.directory, Glama claim, Continue Hub, Codex plugin portal, GitHub MCP Registry partnership email.

## 4. Smithery (captain, immediate)

Mechanism: account-gated URL publish. No free anonymous API. CLI v4.11.1 `mcp publish` prompts for an API key from https://smithery.ai/account/api-keys . `smithery.ai/new` redirects to WorkOS login.

### 4.1 Browser (recommended)

1. Sign in at https://smithery.ai (WorkOS). Use the captain-owned identity.
2. Open https://smithery.ai/new .
3. Enter the public HTTPS MCP URL:

   `https://musicwire.5432wire.com/mcp`

4. Complete the publishing flow. Suggested qualified name: `thatdudealso/musicwire`.
5. Smithery scans unauthenticated Streamable HTTP automatically (User-Agent `SmitheryBot/1.0`). Musicwire `/mcp` currently answers `initialize` without OAuth, so the scan should complete without a test profile.
6. After publish, open the server **Settings → Verification** if you want official-vendor verification.

### 4.2 CLI (same account)

```sh
# Create a key at https://smithery.ai/account/api-keys then:
export SMITHERY_API_KEY='...'
npx -y @smithery/cli mcp publish "https://musicwire.5432wire.com/mcp" -n thatdudealso/musicwire --config-schema '{"type":"object","properties":{},"additionalProperties":false}'
```

Do not publish `https://musicwire.5432wire.com` (site root) as an MCP URL. Do not wait for an MCPB bundle unless you want a local-stdio Smithery listing as well; the hosted URL is the one that matches the live endpoint.

The source serves `/.well-known/mcp/server-card.json` with the same metadata and empty resources/prompts catalogs as the MCP server. Deploy it before re-publishing. If a scan still returns 403, inspect the deployment's handling of Smithery's `User-Agent: SmitheryBot/1.0` before changing access controls.

## 5. Claude Connectors Directory (captain, immediate after Smithery)

Mechanism: Team/Enterprise org portal. Not a public API. Desktop MCPB uses a separate Google form.

### 5.1 Access

- Portal: https://claude.ai/admin-settings/directory/submissions/new
- Dashboard: https://claude.ai/admin-settings/directory/submissions
- Docs: https://claude.com/docs/connectors/building/submission
- Review criteria: https://claude.com/docs/connectors/building/review-criteria
- Escalation: mcp-review@anthropic.com
- Requires a **Team or Enterprise** Claude organization. Individual/Pro/Max cannot submit to the directory. On Team, only Owners. On Enterprise, Owners or a custom role with Directory or Libraries permission.
- Desktop MCPB form (local bundle, not the hosted URL): https://clau.de/desktop-extention-submission
- Skills are not a standalone submission type.

### 5.2 Copy-ready portal fields

Have these ready before opening the portal. Progress saves in-browser only.

| Portal field            | Value                                                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector type          | Remote MCP server                                                                                                                                                                                                                                                                      |
| Server URL              | `https://musicwire.5432wire.com/mcp`                                                                                                                                                                                                                                                   |
| Transport               | Streamable HTTP                                                                                                                                                                                                                                                                        |
| Same URL for every user | Yes                                                                                                                                                                                                                                                                                    |
| Server name (max 100)   | Musicwire                                                                                                                                                                                                                                                                              |
| Tagline (max 55)        | Pay-per-call MusicXML render with automated QC                                                                                                                                                                                                                                         |
| Description (max 2000)  | Canonical longer description in section 1                                                                                                                                                                                                                                              |
| Categories              | Media / Developer tools (pick 1-5 from the portal list)                                                                                                                                                                                                                                |
| Documentation URL       | https://musicwire.5432wire.com/docs                                                                                                                                                                                                                                                    |
| Privacy policy URL      | **blocker** - `GET /privacy` is 404. Missing policy is immediate rejection.                                                                                                                                                                                                            |
| Support                 | https://github.com/thatdudealso/musicwire/issues and ashishyocool@gmail.com                                                                                                                                                                                                            |
| Icon                    | https://musicwire.5432wire.com/musicwire-mark.svg                                                                                                                                                                                                                                      |
| Slug                    | `musicwire` (permanent once published)                                                                                                                                                                                                                                                 |
| Company / website       | Musicwire / https://musicwire.5432wire.com                                                                                                                                                                                                                                             |
| Review contact          | ashishyocool@gmail.com                                                                                                                                                                                                                                                                 |
| Authentication          | No authentication at the MCP transport. Paid tools settle via x402 Exact USDC on Base inside the tool call.                                                                                                                                                                            |
| Data handling           | First-party API. Not health data. Not sponsored content.                                                                                                                                                                                                                               |
| Test access             | Hosted MCP is public. Reviewer can `initialize` and `tools/list` with no account. Paid tools spend real USDC; provide a funded throwaway buyer key only if you want them to run `musicwire_validate` / `musicwire_render`. Free tools: `musicwire_compose_guide`, `musicwire_get_job`. |

Portal steps in order: Introduction, Connection, Tools, Listing, Use cases, Company, Authentication, Data handling, Test & launch, Compliance (seven required acknowledgments), Review.

### 5.3 Hard blockers besides the account

Submit only after these are true, or expect rejection:

1. **Privacy policy URL.** Required. Publish an HTTPS policy covering collection, use, storage, third-party sharing, retention, and contact, then put it at a stable URL (today `/privacy` 404s).
2. **Tool annotations.** Directory rules require every tool to have a `title` plus `readOnlyHint` or `destructiveHint`. The source now supplies those annotations for every tool; deploy and confirm the hosted `tools/list` response before submitting.
3. **Financial / crypto policy.** Review criteria currently list "Transfer money, cryptocurrency, or other financial assets" as an unsupported use case. Musicwire's paid tools capture USDC via x402. The compliance step also has a financial-transactions acknowledgment. Treat this as a likely policy rejection even with a perfect form. Custom connectors (user-added URL) still work without a directory listing.
4. **AI media generation.** The same unsupported list bans generating audio _via AI models_. Musicwire renders with MuseScore, not an AI model, and should be described that way. Do not call it AI music generation in the portal.
5. **Test credentials.** Required "fully populated account." For an unauthenticated public MCP, document that no login exists and that paid calls spend real USDC.

Users can still add Musicwire as a **custom connector** today: Customize > Connectors > Add custom connector > URL `https://musicwire.5432wire.com/mcp`. Free/Pro/Max can add custom connectors; Team/Enterprise Owners add org-level ones.

## 6. PulseMCP, mcp.so paid, x402all

### PulseMCP

- Submit page: https://www.pulsemcp.com/submit
- Current copy (2026-08-30): submissions and listing changes paused until mid-August. The pause text is still up after that date.
- Intended mechanism even when not paused: publish to Official MCP Registry (already done). They ingest daily and process weekly. Manual adjustments: email hello@pulsemcp.com with registry name `io.github.thatdudealso/musicwire-mcp`, GitHub URL, npm `musicwire-mcp`, hosted URL `https://musicwire.5432wire.com/mcp`.
- v0beta API is sunsetting (random 410s). Partner v0.1 API needs `X-API-Key`.
- Goose's extensions directory loads from PulseMCP. Listing there is how Goose users discover Musicwire without a custom extension.

### mcp.so

- https://mcp.so/submit is a **$39 paid** listing. Skip.
- Free path used: GitHub issue https://github.com/chatmcp/mcpso/issues/1 comment https://github.com/chatmcp/mcpso/issues/1#issuecomment-5472062662
- Recheck mcp.so search in a few days. If they ignore the issue, do not buy placement unless the captain chooses to.

### x402all (x402all.com) / AXON (axon402.com)

- Catalog is public. Musicwire is not in it.
- Home page still links "Register your origin" to https://x402all.com/register , but that route **404s** as of 2026-08-30. `POST /api/register` is also 404. Footer JSON contract is not live.
- Captain path: create an AXON account at https://axon402.com/dashboard (SPA console, account-gated). Do not invent credentials.
- When a live seller form exists, use:

| Field            | Value                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Origin / website | https://musicwire.5432wire.com                                                                                             |
| Contact email    | ashishyocool@gmail.com                                                                                                     |
| Wallet           | `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`                                                                               |
| Network / asset  | Base `eip155:8453`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                                                      |
| Protected routes | `POST /v1/validate`, `POST /v1/render`                                                                                     |
| Category         | Media                                                                                                                      |
| Notes            | x402 Exact USDC through CDP. Validation $0.10. Render $0.25 one part / $0.50 multiple parts. Capture only after QC passes. |

## 7. Coding-agent ecosystems

Official MCP Registry is already live. That is the native discovery source for clients that speak the registry spec. It is **not** sufficient for every IDE gallery. Where a client consumes the registry automatically, do not duplicate a submission; where it does not, the captain action is listed.

Dual-audience snippets below: one human line, then exact config. Never put `MUSICWIRE_X402_PRIVATE_KEY` in a committed file. Paid stdio calls read it from the process environment. The hosted MCP URL has no transport auth; paid tools still settle on Base USDC.

### VS Code / GitHub Copilot

Human: In Extensions search `@mcp musicwire`. If it is missing, the GitHub MCP Registry has not ingested this Official Registry entry yet; add it manually or email partnerships@github.com.

Agent / manual `.vscode/mcp.json` (or user MCP settings):

```json
{
  "servers": {
    "musicwire": {
      "type": "http",
      "url": "https://musicwire.5432wire.com/mcp"
    }
  }
}
```

stdio alternative:

```json
{
  "servers": {
    "musicwire": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "musicwire-mcp"],
      "env": {
        "MUSICWIRE_API_URL": "https://musicwire.5432wire.com"
      }
    }
  }
}
```

### Cursor

Human: Settings > MCP > add Musicwire. Listing on cursor.directory requires GitHub or Google sign-in at https://cursor.directory/plugins/new . Cursor Marketplace is also account-gated.

Project file `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "musicwire": {
      "url": "https://musicwire.5432wire.com/mcp"
    }
  }
}
```

stdio:

```json
{
  "mcpServers": {
    "musicwire": {
      "command": "npx",
      "args": ["-y", "musicwire-mcp"],
      "env": {
        "MUSICWIRE_API_URL": "https://musicwire.5432wire.com"
      }
    }
  }
}
```

### Claude Code / `.mcp.json`

Human: Add Musicwire to the project's `.mcp.json` (already in this repo for stdio). For hosted: use a `url` server.

```json
{
  "mcpServers": {
    "musicwire": {
      "url": "https://musicwire.5432wire.com/mcp"
    }
  }
}
```

### Cline

Human: Marketplace submission is issue #2368. Until it is listed, add a remote or stdio server in Cline MCP settings.

Remote: `https://musicwire.5432wire.com/mcp`. stdio command: `npx -y musicwire-mcp` with `MUSICWIRE_API_URL=https://musicwire.5432wire.com`.

### Goose (Block / AAIF)

Human: Goose's directory is PulseMCP. Add a custom extension until PulseMCP lists it.

Remote Streamable HTTP: Extensions > Add custom extension > type Streamable HTTP > endpoint `https://musicwire.5432wire.com/mcp`.

CLI: `goose session --with-streamable-http-extension "https://musicwire.5432wire.com/mcp"`

stdio command: `npx -y musicwire-mcp`

Deeplink (remote):

```text
goose://extension?url=https%3A%2F%2Fmusicwire.5432wire.com%2Fmcp&type=streamable_http&id=musicwire&name=Musicwire&description=Pay-per-call%20MusicXML%20validation%2C%20MuseScore%20rendering%2C%20and%20automated%20QC
```

`~/.config/goose/config.yaml`:

```yaml
extensions:
  musicwire:
    name: Musicwire
    type: streamable_http
    uri: https://musicwire.5432wire.com/mcp
    enabled: true
    timeout: 300
```

Docs live at https://goose-docs.ai/docs/getting-started/using-extensions (the old block.github.io URL 404s).

### Continue

Human: Continue Hub is account-gated. Add a local block instead.

`.continue/mcpServers/musicwire.yaml`:

```yaml
name: Musicwire
version: 0.1.0
schema: v1
mcpServers:
  - name: Musicwire
    type: streamable-http
    url: https://musicwire.5432wire.com/mcp
```

stdio variant: `command: npx`, `args: ["-y", "musicwire-mcp"]`, `env.MUSICWIRE_API_URL: https://musicwire.5432wire.com`. MCP only runs in Continue agent mode.

### Windsurf

Human: no separate free directory found. Add the server in Windsurf MCP settings (typically `~/.codeium/windsurf/mcp_config.json`), same JSON shape as Cursor `mcpServers`. Publishing on Smithery is the highest-leverage Windsurf discovery path.

### OpenAI Codex

Human: Codex does not install from the Official MCP Registry automatically. Add a table in `~/.codex/config.toml`. Plugin / ChatGPT connector directories are account-gated and want a privacy policy.

Remote:

```toml
[mcp_servers.musicwire]
url = "https://musicwire.5432wire.com/mcp"
```

stdio:

```toml
[mcp_servers.musicwire]
command = "npx"
args = ["-y", "musicwire-mcp"]

[mcp_servers.musicwire.env]
MUSICWIRE_API_URL = "https://musicwire.5432wire.com"
```

Then `codex mcp list`. Do not mix `command` and `url` in the same table.

## 8. Other reputable free directories

Executed if free API/PR; otherwise listed for the captain.

| Directory                     | Mechanism                                                | Recommendation                                                                                           |
| ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| MCP Central                   | Mirrors Official MCP Registry daily. No extra submit.    | Wait for sync. Already published upstream.                                                               |
| GitHub MCP Registry           | Email `partnerships@github.com` after Official Registry. | Captain should send a short request with registry name, npm, GitHub, hosted URL. Unlocks VS Code `@mcp`. |
| punkpeye/awesome-mcp-servers  | Free GitHub PR. Reputable.                               | **Recommend.** Copy-ready line below. Not filed here (external fork; keep this PR to the packet).        |
| appcypher/awesome-mcp-servers | Free GitHub PR, smaller list.                            | Optional follow-on.                                                                                      |
| LobeHub Marketplace           | Account-gated publish.                                   | Skip until captain signs in.                                                                             |
| AllMCPs                       | Free submit tool plus paid boost/Stripe.                 | Skip paid boost. Free submit is optional and less well-known.                                            |
| mcpservers.org                | Browser form.                                            | Not executed; reputation mixed. Prefer Official Registry + PulseMCP.                                     |

Recommended awesome-mcp-servers entry (music / audio / media category, follow their current CONTRIBUTING):

```md
- [Musicwire](https://github.com/thatdudealso/musicwire) - Paid MusicXML validation, MuseScore rendering, and automated QC for AI agents; payment is captured only after QC passes.
```

Do **not** open or edit `xpaysh/awesome-x402` PR #1304.

## 9. Dead end

**x402list.com** (no hyphen) is a parked domain, not a directory. Skip it. Musicwire's **x402-list.com** (with hyphen) listing was approved on 2026-08-31.

## 10. Captain-owned remaining gates

1. **Smithery account** - deploy the hosted MCP metadata, then sign in and re-publish `https://musicwire.5432wire.com/mcp` as `thatdudealso/musicwire` with the explicit empty config schema (section 4). Highest remaining discovery leverage.
2. **npm `musicwire-mcp@0.1.3`** - stdio npm is still 0.1.1. The repository package is prepared as 0.1.3. Publishing 0.1.3 is blocked on the captain-owned npm credential task. Do not publish this repository's private root package. Re-publish Official Registry only after that npm version exists.
3. **Privacy policy** - publish before Claude Connectors, Codex/ChatGPT connector directories, and any review that requires one.
4. **Claude Connectors** - Team/Enterprise org + policy/annotation work (section 5). Expect possible crypto-transfer rejection; custom connector URL still works.
5. **PulseMCP** - wait for pause to lift and weekly ingest, or email hello@pulsemcp.com (section 6). Unblocks Goose directory.
6. **AXON / x402all** - captain account at https://axon402.com/dashboard once their register route is live (section 6).
7. **GitHub MCP Registry** - email partnerships@github.com (section 8).
8. **cursor.directory** - sign in with GitHub or Google at https://cursor.directory/plugins/new .
9. **Glama claim** - sign in and claim if/when the auto-index appears.
10. **Cline issue #2368** - if they require a 400x400 PNG attachment, drag-drop a raster of `/musicwire-mark.svg`. This worker could not upload binary to a gist from this environment.
11. **awesome-mcp-servers PR** - optional, copy-ready in section 8.
12. **Do not touch** awesome-x402 PR #1304.

Recheck signals: PulseMCP search, mcp.so search, mcp.directory search, x402-list.com `/api/v1/services?q=musicwire`, Smithery search for `musicwire`, VS Code `@mcp musicwire`.
