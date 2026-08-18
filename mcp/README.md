# musicwire-mcp

`musicwire-mcp` is a stdio [Model Context Protocol](https://modelcontextprotocol.io/) server for Musicwire. It gives an MCP client four tools:

- `musicwire_compose_guide` - get the free MusicXML authoring guide.
- `musicwire_validate` - pay for detailed MusicXML validation.
- `musicwire_render` - pay to queue a MusicXML render.
- `musicwire_get_job` - inspect a render or poll it to completion.

Paid calls use x402 Exact USDC on Base Sepolia (`eip155:84532`). The server retries a `402 Payment Required` response with a signed payment automatically. It never logs or persists the private key.

## Install

Run it directly from an MCP client:

```sh
npx -y musicwire-mcp
```

The package requires Node.js 22.5 or newer.

## Configuration

| Variable                     | Required            | Description                                                                                      |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `MUSICWIRE_API_URL`          | No                  | Musicwire base URL. Defaults to `http://127.0.0.1:8787`.                                         |
| `MUSICWIRE_X402_PRIVATE_KEY` | For paid x402 calls | Throwaway Base Sepolia buyer private key. `X402_PRIVATE_KEY` is also accepted for compatibility. |
| `MUSICWIRE_MCP_PAYMENT_MODE` | No                  | `x402` (default), or the test-only `stub` mode for a loopback API.                               |

`stub` mode retries challenges with a non-secret test authorization and is rejected unless `MUSICWIRE_API_URL` points at `localhost`, `127.0.0.1`, or `::1`. It is for Musicwire's explicit local stub profile only. Never use it for a remote API.

Keep the buyer wallet funded only with Base Sepolia test USDC. Musicwire has no mainnet configuration in this package. Treat the private key as a secret: inject it through your client environment, do not put it in a repository or client configuration file, and rotate it if exposed.

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

Before starting Claude Code, export a funded testnet buyer key:

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

For `musicwire_validate` and `musicwire_render`, the package sends the original request first. If Musicwire returns `402`, the x402 client reads the payment requirements, signs an Exact EVM authorization with the configured Base Sepolia buyer wallet, and repeats the identical request with `Payment-Signature`. Musicwire verifies the authorization before work and captures only after quality control passes. Job polling and the compose guide are free.

`idempotency_key` is available on the two paid tools. Reuse it when retrying a request to ensure Musicwire replays the original outcome instead of creating another payment authorization.
