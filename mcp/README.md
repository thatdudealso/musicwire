# musicwire-mcp

`musicwire-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io/) server for Musicwire. It gives an MCP client five tools:

- `musicwire_compose_guide` - get the free MusicXML authoring guide.
- `musicwire_validate` - pay for detailed MusicXML validation.
- `musicwire_render` - pay to queue a MusicXML render.
- `musicwire_get_job` - inspect a render or poll it to completion.
- `musicwire_verify_provenance` - free check of an artifact SHA-256 against signed render receipts.

Local MCP clients such as Claude Code and Cursor run this package over stdio:

```sh
npx -y musicwire-mcp
```

Hosted MCP clients such as Claude Connectors and [Smithery](https://smithery.ai/servers/thatdudealso/musicwire) use the public Streamable HTTP endpoint served by the Musicwire API:

```
https://musicwire.5432wire.com/mcp
```

That hosted endpoint exposes the same tools and needs no Smithery session config (the listed config schema is an empty object). It does not hold a buyer wallet. `musicwire_validate` and `musicwire_render` return HTTP `402 Payment Required` with the same x402 quote as `POST /v1/validate` and `POST /v1/render`. Retry the identical MCP request with `Payment-Signature`. Compose guide, job polling, and provenance verify stay free.

Over the hosted endpoint, poll `musicwire_get_job` with repeated short calls instead of one long `wait_for_completion` hold: the gateway in front of the hosted endpoint times out requests after roughly 29 seconds, while the render itself continues and stays pollable. Long `wait_for_completion` waits are fine over stdio.

The only requestable render outputs are MP3 for listening and MIDI for editing. Completed renders also include the source MusicXML, `NOTICE.txt`, and `receipt.json`.

Paid calls use x402 Exact USDC on Base. The server reads `GET /manifest` from the configured API and pays on the network that deployment advertises: Base mainnet (`eip155:8453`) or Base Sepolia (`eip155:84532`). It retries a `402 Payment Required` response with a signed payment automatically, and never logs or persists the private key.

## Install

The package requires Node.js 22.5 or newer. Run the stdio server directly from an MCP client with `npx -y musicwire-mcp`, or point a Streamable HTTP MCP client at `https://musicwire.5432wire.com/mcp`.

## Configuration

| Variable                     | Required            | Description                                                                                                                                 |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `MUSICWIRE_API_URL`          | No                  | Musicwire base URL. Defaults to `http://127.0.0.1:8787`.                                                                                    |
| `MUSICWIRE_X402_PRIVATE_KEY` | For paid x402 calls | Throwaway buyer private key, funded on the network the target deployment advertises. `X402_PRIVATE_KEY` is also accepted for compatibility. |
| `MUSICWIRE_MCP_PAYMENT_MODE` | No                  | `x402` (default), or the test-only `stub` mode for a loopback API.                                                                          |

The server starts and serves the free tools without a key. The key is read only when a paid call actually receives `402 Payment Required`; if it is missing at that point, the tool call fails with an error telling you to set it. Smithery's hosted listing does not collect these variables: declare no session fields, then pay each `musicwire_validate` / `musicwire_render` call with `Payment-Signature`.

`stub` mode retries challenges with a non-secret test authorization and is rejected unless `MUSICWIRE_API_URL` points at `localhost`, `127.0.0.1`, or `::1`. It is for Musicwire's explicit local stub profile only. Never use it for a remote API. The hosted `/mcp` endpoint never enables stub auto-pay and never holds a server-side buyer key.

Fund the buyer wallet on the network the target deployment advertises: real USDC on Base mainnet for the hosted deployment, test USDC on Base Sepolia for a local one. This package never picks the network itself, so it cannot pay on a network the server did not quote, and it refuses any advertised network other than those two. Treat the private key as a secret: inject it through your client environment, do not put it in a repository or client configuration file, and rotate it if exposed.

## Claude Code

Add this to the project's `.mcp.json`, substituting the deployed API URL. Keep the private key in the shell environment that starts Claude Code rather than committing it in this file.

```json
{
  "mcpServers": {
    "musicwire": {
      "command": "npx",
      "args": ["-y", "musicwire-mcp"],
      "env": {
        "MUSICWIRE_API_URL": "https://musicwire.example"
      }
    }
  }
}
```

Before starting Claude Code, export a buyer key funded on the network that deployment advertises:

```sh
export MUSICWIRE_X402_PRIVATE_KEY='0x...'
claude
```

## Cursor

Add the same server entry to Cursor's MCP configuration (`.cursor/mcp.json` for a project, or the equivalent global MCP configuration):

```json
{
  "mcpServers": {
    "musicwire": {
      "command": "npx",
      "args": ["-y", "musicwire-mcp"],
      "env": {
        "MUSICWIRE_API_URL": "https://musicwire.example"
      }
    }
  }
}
```

Start Cursor from an environment that exports `MUSICWIRE_X402_PRIVATE_KEY`; do not store the key in the JSON configuration.

## Local, zero-cost development

Run Musicwire with its explicit non-production stub profile, then start the MCP server with stub mode:

```sh
ARTIFACT_SIGNING_SECRET='replace-with-a-long-random-secret' docker compose up

MUSICWIRE_API_URL='http://127.0.0.1:8787' \
MUSICWIRE_MCP_PAYMENT_MODE=stub \
npx -y musicwire-mcp
```

The repository's `test/mcp-e2e.test.js` uses a real stdio MCP session against this payment behavior and exercises every tool. It creates no wallet, uses no credentials, and sends no funds.

## Payment behavior

For `musicwire_validate` and `musicwire_render`, the package sends the original request first. If Musicwire returns `402`, it reads the advertised payment network from `GET /manifest`, then the x402 client reads the payment requirements, signs an Exact EVM authorization with the configured buyer wallet on that network, and repeats the identical request with `Payment-Signature`. Musicwire verifies the authorization before work and captures only after quality control passes. Job polling, the compose guide, and provenance verify are free. The hosted Streamable HTTP endpoint returns that `402` to the calling agent instead of paying.

`idempotency_key` is available on the two paid tools. Reuse it with the same payer when retrying a request to ensure Musicwire replays the original outcome instead of creating another payment authorization. Reusing it with a different payload for that payer returns HTTP 409 and does not charge.
