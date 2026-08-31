# Musicwire listing and registry launch packet

Truth pass 2026-08-31, rebased onto main after PR #21 (Smithery MCP metadata), PR #23/#24 (x402-list badge + approval), and PR #25 (agent-flow demos). This packet records what is live, what this worker submitted, and the exact remaining captain-owned steps. It does not authorize invented accounts, paid placements, or the open `xpaysh/awesome-x402` PR #1304.

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
| stdio MCP              | `npx -y musicwire-mcp` (`musicwire-mcp@0.1.1` on npm; source is 0.1.3)                                  |
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
| Privacy policy         | **missing** (`GET /privacy` is 404 as of 2026-08-31)                                                    |

Live verify (2026-08-31): hosted Streamable HTTP `POST https://musicwire.5432wire.com/mcp` returns HTTP 200 `initialize` with server `musicwire-mcp` 0.1.2. Health 200, renderer ready. Docs gallery live. npm stdio package remains `musicwire-mcp@0.1.1`. Official Registry status `active`, version 0.1.1, stdio package only (no `remotes[]` for the hosted URL). Remote listings must use `https://musicwire.5432wire.com/mcp`, not the site root and not Smithery's proxy host `https://musicwire--thatdudealso.run.tools`. The hosted endpoint does not hold a buyer wallet; paid tools still settle x402 Exact USDC on Base inside the tool call.

Source (PR #21, merged) now serves `GET /.well-known/mcp/server-card.json`, empty `resources`/`prompts` catalogs, tool `title` plus `readOnlyHint`/`destructiveHint`, and an empty Smithery `configSchema` (`musicwireMcpConfigSchema`, repo-root `smithery.yaml`). Confirm production has picked that deploy up before Smithery republish or Claude Connectors submit.

Do not disclose infrastructure internals (buckets, containers, internal hosts) in any listing.

## 2. Status at a glance

| Target                               | Status                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm `musicwire-mcp`                  | **live**                                                 | 0.1.1 remains published. Source package is prepared as 0.1.3 (PR #21). A captain must publish it. Hosted `initialize` already reports 0.1.2.                                                                                                                                                                                                                         |
| Official MCP Registry                | **live**                                                 | `io.github.thatdudealso/musicwire-mcp` 0.1.1, published 2026-08-24, `status=active`. Search `https://registry.modelcontextprotocol.io/v0.1/servers?search=musicwire` returns this record. Re-publish 0.1.3 through OIDC after the npm publish. Record is stdio-only; hosted remote is not in `remotes[]`.                                                            |
| Hosted MCP `/mcp`                    | **live**                                                 | `POST https://musicwire.5432wire.com/mcp`. This listing pass observed 5 tools without annotations and `GET /.well-known/mcp/server-card.json` 404 on production. PR #21 merged those metadata fixes into source; confirm production before republish.                                                                                                                |
| 9-track docs gallery                 | **live**                                                 | https://musicwire.5432wire.com/docs                                                                                                                                                                                                                                                                                                                                  |
| Repo homepage + topics               | **done**                                                 | Homepage `https://musicwire.5432wire.com`. Topics: `mcp`, `musescore`, `musicxml`, `x402`, `usdc`, `base`, `ai-agents`, `agent-payments`, `api`, `music-generation`. README has Smithery and x402-list badges.                                                                                                                                                       |
| CDP Bazaar                           | **discoverable flag live; catalog hit not proven**       | Manifest `payment.discovery.bazaar.discoverable: true` with routes `POST /v1/validate` and `POST /v1/render`. Public `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources` first 50 items did not include musicwire/5432wire. Indexing is async after settlement.                                                                                      |
| agent402.tools                       | **listed**                                               | `GET https://agent402.tools/api/index?seller=musicwire.5432wire.com`: `health=1`, `routable=true`, `toolCount=1`, pay-to `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f` on `eip155:8453`.                                                                                                                                                                              |
| x402-list.com (hyphen)               | **approved**                                             | Listing https://x402-list.com/services/musicwire approved 2026-08-31 (PR #24; README badge live). Prior submission_id `637f83bd-4164-4479-9ab5-f6bd281831d4`.                                                                                                                                                                                                        |
| mcp.directory                        | **submitted, not yet searchable**                        | Prior `POST /api/submit-server` `{ok:true}`. Homepage HTML on 2026-08-31 does not contain `musicwire`.                                                                                                                                                                                                                                                               |
| mcp.so free queue                    | **submitted; search Cloudflare-gated**                   | Comment still live: https://github.com/chatmcp/mcpso/issues/1#issuecomment-5472062662 . Public search is a Turnstile wall. Paid $39 skipped.                                                                                                                                                                                                                         |
| Cline Marketplace                    | **submitted, open**                                      | https://github.com/cline/mcp-marketplace/issues/2368 still `open`.                                                                                                                                                                                                                                                                                                   |
| PulseMCP                             | **still missing**                                        | `https://api.pulsemcp.com/v0beta/servers?query=musicwire` -> `total_count=0`. Browser `/servers?q=musicwire` is Access Denied; contact `hello@pulsemcp.com`. Email packet in section 6.                                                                                                                                                                              |
| Smithery                             | **listed, score 45/100; republish blocked on auth**      | Live URL https://smithery.ai/servers/thatdudealso/musicwire . Public page: score **45/100**, "No description", 5 tools, published 2026-08-31. Registry `configSchema` is already `{}`. Connection URL is Smithery proxy `https://musicwire--thatdudealso.run.tools`, not the first-party `/mcp`. CLI `npx -y smithery@latest auth whoami` = no token. See section 4. |
| Claude Connectors Directory          | **blocked on captain Team/Enterprise + product gaps**    | Portal https://claude.ai/admin-settings/directory/submissions/new . Privacy policy 404 and production tool annotations (until PR #21 is deployed) are hard blockers. Crypto-transfer policy remains a likely rejection. Custom connector URL still works. See section 5.                                                                                             |
| x402all / axon402                    | **form visible; register API not live**                  | Browser submit on 2026-08-31 returned "Not yet wired. ... `/api/register` ... not live yet." `POST /api/register` still 404. Captain path: AXON dashboard when their register route is live. See section 6.                                                                                                                                                          |
| Glama                                | **not indexed; claim-needed**                            | Named URLs `@thatdudealso/musicwire` and `thatdudealso/musicwire` 404. Search `"musicwire" matching MCP servers` returned an empty page (`hasNextPage=false`). Add Connector / claim require sign-in.                                                                                                                                                                |
| GitHub MCP Registry / VS Code `@mcp` | **not automatic**                                        | Official Registry is upstream. Curated GitHub MCP Registry still wants email to `partnerships@github.com`. Packet in section 8.                                                                                                                                                                                                                                      |
| cursor.directory plugins             | **blocked on GitHub/Google sign-in + Vercel checkpoint** | https://cursor.directory/plugins/new is a Vercel Security Checkpoint from this worker.                                                                                                                                                                                                                                                                               |
| Goose extensions directory           | **consumes PulseMCP**                                    | No separate public listing PR. Users add stdio or Streamable HTTP themselves until PulseMCP lists it.                                                                                                                                                                                                                                                                |
| Continue Hub                         | **account-gated**                                        | `hub.continue.dev` did not resolve from this worker. Users can still add YAML locally.                                                                                                                                                                                                                                                                               |
| Windsurf marketplace                 | **no free public API/PR found**                          | Users add `mcp_config.json`. Smithery is the highest-leverage Windsurf discovery path.                                                                                                                                                                                                                                                                               |
| OpenAI Codex / ChatGPT plugins       | **account-gated**                                        | ChatGPT Plugins https://chatgpt.com/plugins (developer mode). Directory/plugin submission wants a public HTTPS `/mcp` URL and reviewed metadata. Privacy policy is a hard blocker for review. Users can add `~/.codex/config.toml` today.                                                                                                                            |
| punkpeye/awesome-mcp-servers         | **PR opened this pass**                                  | https://github.com/punkpeye/awesome-mcp-servers/pull/13262                                                                                                                                                                                                                                                                                                           |
| wong2/awesome-mcp-servers            | **fork ready; PR permission denied**                     | Upstream `has_pull_requests=false` / collaborators-only. Branch: https://github.com/thatdudealso/awesome-mcp-servers-1/tree/add-musicwire                                                                                                                                                                                                                            |
| `xpaysh/awesome-x402` PR #1304       | **do not touch**                                         | Separate captain decision.                                                                                                                                                                                                                                                                                                                                           |
| x402list.com (no hyphen)             | **dead end**                                             | Parked domain, not a directory. Skip.                                                                                                                                                                                                                                                                                                                                |

## 3. What this 2026-08-31 pass executed

Re-verified live listings, then did every worker-doable submission. Registry posting later in this same task was stopped by captain order; this packet keeps those earlier submissions.

1. **Re-verify** - hosted MCP initialize 200 / `musicwire-mcp` 0.1.2; Official Registry active; GitHub topics present; Smithery listing 200 with score 45/100; agent402 seller record healthy; PulseMCP API empty; Glama named URLs 404; CDP public catalog first page no musicwire hit; privacy `/privacy` 404. x402-list is now **approved** (later main PRs #23/#24).
2. **Smithery CLI** - `npx -y smithery@latest auth whoami` = no token. Did not invent an account. Did not republish. Command ready in section 4.
3. **x402all HTML form** - filled origin `https://musicwire.5432wire.com/v1/render`, contact `ashishyocool@gmail.com`, wallet `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`, notes with validate sibling + pricing. Submit response: **"Not yet wired"** because `POST /api/register` is not live.
4. **punkpeye/awesome-mcp-servers** - opened https://github.com/punkpeye/awesome-mcp-servers/pull/13262 (Art & Culture, agent title suffix per their CONTRIBUTING).
5. **wong2/awesome-mcp-servers** - forked to `thatdudealso/awesome-mcp-servers-1`, committed Community Servers line on `add-musicwire`. `gh-axi pr create` failed: `thatdudealso does not have the correct permissions to execute CreatePullRequest`.
6. **mcp.so search** - Cloudflare Turnstile in this worker browser; free-queue comment already posted, not redone.
7. **PulseMCP / Glama / cursor.directory / Claude portal / Continue Hub / ChatGPT plugins** - not signed in; packets below. No invented accounts.

Not executed (account, paid, policy, missing live API, or out of scope): Smithery republish, Claude Connectors submit, PulseMCP email send, mcp.so $39, GitHub MCP Registry email send, cursor.directory publish, Glama claim, Continue Hub publish, Codex/ChatGPT directory submit, npm publish, `xpaysh/awesome-x402` PR #1304.

## 4. Smithery (captain, immediate)

Listing already exists: https://smithery.ai/servers/thatdudealso/musicwire

Recorded public quality score on 2026-08-31: **45/100**. Visible issues on the public page: empty description ("No description"), connection through Smithery proxy `https://musicwire--thatdudealso.run.tools`. Registry already has empty `configSchema: {}`. Source now has tool annotations and `GET /.well-known/mcp/server-card.json` (PR #21); confirm that deploy is live in production before republishing.

`npx -y smithery@latest` (CLI v1.2.0) `auth whoami` from this worker: **No token found**. Isolated Chrome showed a Login link; the operator Chrome DevTools port was not available.

### 4.1 Captain login + republish (required to raise the score)

```sh
npx -y smithery@latest auth login
# then:
npx -y smithery@latest mcp publish "https://musicwire.5432wire.com/mcp" \
  -n thatdudealso/musicwire \
  --config-schema '{"type":"object","properties":{},"additionalProperties":false}'
```

Confirm after publish:

- Listing URL remains https://smithery.ai/servers/thatdudealso/musicwire
- Connection shows `https://musicwire.5432wire.com/mcp` (or a proxy in front of it), never the site root
- Description is the canonical longer description
- Score is recorded from the public page (`N/100` next to the title)

Browser path if CLI is awkward: sign in at https://smithery.ai (WorkOS) -> https://smithery.ai/new -> URL `https://musicwire.5432wire.com/mcp` -> qualified name `thatdudealso/musicwire`. After publish, Settings -> Verification for official-vendor verification.

Do not wait for an MCPB bundle. Do not publish `https://musicwire.5432wire.com` (site root) as an MCP URL.

If the scan returns 403, inspect the deployment's handling of Smithery's `User-Agent: SmitheryBot/1.0` before changing access controls. The source already serves `/.well-known/mcp/server-card.json`.

## 5. Claude Connectors Directory (captain, after Smithery)

Mechanism: Team/Enterprise org portal. Not a public API. Desktop MCPB uses a separate Google form.

Docs (current 2026-08-31): https://claude.com/docs/connectors/building/submission

### 5.1 Access

- Portal: https://claude.ai/admin-settings/directory/submissions/new
- Dashboard: https://claude.ai/admin-settings/directory/submissions
- Review criteria: https://claude.com/docs/connectors/building/review-criteria
- Escalation: mcp-review@anthropic.com
- Requires a **Team or Enterprise** Claude organization. Individual/Pro/Max cannot submit to the directory. On Team, only Owners. On Enterprise, Owners or a custom role with Directory or Libraries permission.
- Desktop MCPB form (local bundle, not the hosted URL): https://clau.de/desktop-extention-submission

This worker was not signed in. Do not invent a Team org.

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
| Privacy policy URL      | **hard blocker** - `GET /privacy` is 404. Missing policy is immediate rejection.                                                                                                                                                                                                       |
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

1. **Privacy policy URL.** Required. Publish an HTTPS policy covering collection, use, storage, third-party sharing, retention, and contact, then put it at a stable URL (today `/privacy` 404s). Adding a privacy policy is a captain decision (`AGENTS.md`).
2. **Tool annotations.** Directory rules require every tool to have a `title` plus `readOnlyHint` or `destructiveHint`. Source now supplies those annotations for every tool (PR #21). Confirm the hosted `tools/list` response before submitting; this listing pass still saw production without them.
3. **Financial / crypto policy.** Review criteria currently list "Transfer money, cryptocurrency, or other financial assets" as an unsupported use case. Musicwire's paid tools capture USDC via x402. Treat this as a likely policy rejection even with a perfect form. Custom connectors (user-added URL) still work without a directory listing.
4. **AI media generation.** The same unsupported list bans generating audio _via AI models_. Musicwire renders with MuseScore, not an AI model. Do not call it AI music generation in the portal.
5. **Test credentials.** Required "fully populated account." For an unauthenticated public MCP, document that no login exists and that paid calls spend real USDC.

Users can still add Musicwire as a **custom connector** today: Customize > Connectors > Add custom connector > URL `https://musicwire.5432wire.com/mcp`. Free/Pro/Max can add custom connectors; Team/Enterprise Owners add org-level ones.

## 6. PulseMCP, mcp.so, x402all

### PulseMCP (email if still missing - it is)

- Search API 2026-08-31: `https://api.pulsemcp.com/v0beta/servers?query=musicwire` -> `{servers:[], total_count:0}`
- Submit / search pages: Access Denied from this worker; copy tells crawlers to email hello@pulsemcp.com
- They ingest Official Registry daily and process weekly. Goose's directory loads from PulseMCP.

Captain: send this exact mail (do not invent a mailbox; use ashishyocool@gmail.com):

```text
To: hello@pulsemcp.com
Subject: Please ingest io.github.thatdudealso/musicwire-mcp

Musicwire is already active on the Official MCP Registry as
io.github.thatdudealso/musicwire-mcp (published 2026-08-24).
PulseMCP search still returns zero servers for "musicwire".

Please ingest or list:

- Registry name: io.github.thatdudealso/musicwire-mcp
- GitHub: https://github.com/thatdudealso/musicwire
- npm: musicwire-mcp
- Hosted Streamable HTTP: https://musicwire.5432wire.com/mcp
- Docs: https://musicwire.5432wire.com/docs
- One-liner: Pay-per-call MusicXML validation, MuseScore rendering, and automated QC for AI agents.

Thank you.
```

### mcp.so

- https://mcp.so/submit is a **$39 paid** listing. Skip.
- Free path already used: https://github.com/chatmcp/mcpso/issues/1#issuecomment-5472062662
- Recheck search in a signed-in human browser (Turnstile). If they ignore the issue, do not buy placement unless the captain chooses to.

### x402all / AXON

- HTML form at https://x402all.com/register is visible and fillable.
- This worker submitted the filled form on 2026-08-31. On-page status: **"Not yet wired. Your entry would have been posted to /api/register, but that route is not live yet."**
- `POST https://x402all.com/api/register` is 404. The page itself says the JSON contract comes online in a future milestone.
- Musicwire is not in the public catalog HTML.
- Captain path: create an AXON account at https://axon402.com/dashboard (SPA console, account-gated). Do not invent credentials. Retry the HTML form only after `/api/register` returns non-404.

When a live seller form exists, use:

| Field                    | Value                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin / website         | https://musicwire.5432wire.com                                                                                                                                            |
| 402 endpoint (this form) | https://musicwire.5432wire.com/v1/render                                                                                                                                  |
| Contact email            | ashishyocool@gmail.com                                                                                                                                                    |
| Wallet                   | `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`                                                                                                                              |
| Network / asset          | Base `eip155:8453`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`                                                                                                     |
| Protected routes         | `POST /v1/validate`, `POST /v1/render`                                                                                                                                    |
| Category                 | Media                                                                                                                                                                     |
| Notes                    | x402 Exact USDC through CDP. Validation $0.10. Render $0.25 one part / $0.50 multiple parts. Capture only after QC passes. Hosted MCP: https://musicwire.5432wire.com/mcp |

## 7. Coding-agent ecosystems

Official MCP Registry is already live. That is the native discovery source for clients that speak the registry spec. It is **not** sufficient for every IDE gallery. Where a client consumes the registry automatically, do not duplicate a submission; where it does not, the captain action is listed.

Dual-audience snippets below: one human line, then exact config. Never put `MUSICWIRE_X402_PRIVATE_KEY` in a committed file. Paid stdio calls read it from the process environment. The hosted MCP URL has no transport auth; paid tools still settle on Base USDC.

### VS Code / GitHub Copilot

Human: In Extensions search `@mcp musicwire`. If it is missing, the GitHub MCP Registry has not ingested this Official Registry entry yet; add it manually or email partnerships@github.com (section 8).

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

Human: Settings > MCP > add Musicwire. Listing on cursor.directory requires GitHub or Google sign-in at https://cursor.directory/plugins/new (Vercel checkpoint from this worker). Cursor Marketplace is also account-gated.

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

Human: Marketplace submission is issue #2368 (still open). Until it is listed, add a remote or stdio server in Cline MCP settings.

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

Human: Continue Hub is account-gated (`hub.continue.dev` did not resolve here). Add a local block instead.

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

### OpenAI Codex / ChatGPT plugins

Human: Codex does not install from the Official MCP Registry automatically. Add a table in `~/.codex/config.toml`. ChatGPT developer-mode custom MCP: Settings > Security and login > Developer mode, then https://chatgpt.com/plugins plus button, connection = public HTTPS URL **including `/mcp`**.

Directory / plugin review (https://developers.openai.com/plugins/deploy/submission and https://developers.openai.com/apps-sdk/deploy/connect-chatgpt): account-gated. Hosted URL must be `https://musicwire.5432wire.com/mcp`, never the site root. A public privacy policy is a hard blocker for directory review (`GET /privacy` is 404). Tool annotations are expected; source has them after PR #21, production must match.

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

| Directory                                              | Mechanism                                                | This-pass result                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| MCP Central                                            | Mirrors Official MCP Registry daily. No extra submit.    | Wait for sync. Already published upstream.                                                                           |
| GitHub MCP Registry (`github.com/mcp`, VS Code `@mcp`) | Email `partnerships@github.com` after Official Registry. | Packet below. Not automatic.                                                                                         |
| punkpeye/awesome-mcp-servers                           | Free GitHub PR.                                          | **Opened:** https://github.com/punkpeye/awesome-mcp-servers/pull/13262                                               |
| wong2/awesome-mcp-servers                              | Free GitHub PR in theory.                                | Upstream disables public PRs. Branch ready: https://github.com/thatdudealso/awesome-mcp-servers-1/tree/add-musicwire |
| appcypher/awesome-mcp-servers                          | Free GitHub PR, smaller list.                            | Optional follow-on. Not filed this pass.                                                                             |
| LobeHub Marketplace                                    | Account-gated publish.                                   | Skip until captain signs in.                                                                                         |
| AllMCPs                                                | Free submit tool plus paid boost/Stripe.                 | Skip paid boost.                                                                                                     |
| mcpservers.org                                         | Browser form.                                            | Not executed; prefer Official Registry + PulseMCP.                                                                   |

GitHub MCP Registry captain email (send from ashishyocool@gmail.com; do not invent a mailbox):

```text
To: partnerships@github.com
Subject: Request inclusion of io.github.thatdudealso/musicwire-mcp in the GitHub MCP Registry

Please consider Musicwire for the curated GitHub MCP Registry / VS Code @mcp gallery.

- Official MCP Registry (active): io.github.thatdudealso/musicwire-mcp
- npm: musicwire-mcp
- GitHub: https://github.com/thatdudealso/musicwire
- Hosted Streamable HTTP: https://musicwire.5432wire.com/mcp
- Docs: https://musicwire.5432wire.com/docs
- One-liner: Pay-per-call MusicXML validation, MuseScore rendering, and automated QC for AI agents.

It is already published to the open Official MCP Registry (2026-08-24). Thank you.
```

Do **not** open or edit `xpaysh/awesome-x402` PR #1304.

## 9. Dead end

**x402list.com** (no hyphen) is a parked domain, not a directory. Skip it. Musicwire's **x402-list.com** (with hyphen) listing was approved on 2026-08-31: https://x402-list.com/services/musicwire

## 10. Captain-owned remaining gates

1. **Smithery auth + republish** - `npx -y smithery@latest auth login`, then publish `https://musicwire.5432wire.com/mcp` as `thatdudealso/musicwire` with the empty configSchema (section 4). Highest remaining discovery leverage. Current public score **45/100**. Confirm PR #21 metadata is live in production first.
2. **npm `musicwire-mcp@0.1.3`** - stdio npm is still 0.1.1. Source is 0.1.3 after PR #21. Hosted `initialize` already reports 0.1.2. Publishing is blocked on the captain-owned npm credential. Do not publish this repository's private root package. Re-publish Official Registry only after that npm version exists. Adding a hosted `remotes[]` entry is the same publish.
3. **Privacy policy** - publish before Claude Connectors, Codex/ChatGPT connector directories, and any review that requires one. Captain decision, not a maintenance change.
4. **Claude Connectors** - Team/Enterprise org + policy/annotation work (section 5). Expect possible crypto-transfer rejection; custom connector URL still works.
5. **PulseMCP** - send the hello@pulsemcp.com packet (section 6). Unblocks Goose directory.
6. **AXON / x402all** - wait for `POST /api/register` or captain account at https://axon402.com/dashboard (section 6). HTML form is a stub.
7. **GitHub MCP Registry** - send partnerships@github.com (section 8). Unlocks VS Code `@mcp`.
8. **cursor.directory** - sign in with GitHub or Google at https://cursor.directory/plugins/new .
9. **Glama claim** - sign in and claim if/when the auto-index appears. Not indexed on 2026-08-31.
10. **Cline issue #2368** - if they require a 400x400 PNG attachment, drag-drop a raster of `/musicwire-mark.svg`.
11. **wong2 awesome list** - only if they enable public PRs; branch is already on `thatdudealso/awesome-mcp-servers-1`.
12. **Confirm production deploy of PR #21** (server-card, tool annotations, empty catalogs) before Smithery republish or Claude Connectors submit.
13. **Do not touch** awesome-x402 PR #1304. Skip x402list.com (no hyphen). Skip mcp.so $39.

Recheck signals: Smithery page score next to https://smithery.ai/servers/thatdudealso/musicwire , PulseMCP search, mcp.so search, mcp.directory search, x402-list.com `/api/v1/services?q=musicwire`, VS Code `@mcp musicwire`, Glama `@thatdudealso/musicwire`.
