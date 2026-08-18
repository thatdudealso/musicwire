# Base Sepolia x402 E2E evidence

Date: 2026-08-17

Network: `eip155:84532` (Base Sepolia)

Receiving CDP Server Wallet: `0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f`

## Coinbase CDP buyer via `@x402/fetch`

The named CDP buyer `musicwire-x402-e2e-buyer` at `0x54580Df485A6f6acDC1028a50B07A97bdB3BafD3` was funded with test USDC. Circle's browser faucet presented an interactive CAPTCHA, so the CDP Base Sepolia faucet supplied test USDC instead. Faucet transaction: `0x9becd0a7dabbd611be88014969893f05eff056a14a4658fb89f5bf2b04951a7e`.

Command transcript summary:

```text
quote: 402
network: eip155:84532
amount: 250000 atomic USDC
payTo: 0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f

paid render: 202 -> completed
job: 89c5caee-bd38-41ec-b5ed-02388d2c5544
settlement: 0x8cf6caa09631034dd778042121fc2ab9c180bdb3e1a2b47c75528dcaff4bc40e
buyer delta: -250000 atomic USDC
receiver delta: +250000 atomic USDC
receipt artifact: verified

QC failure: 202 -> failed_not_charged
job: ce160ed0-13f2-491c-ada7-b0874c2d9217
tx_hash: null
buyer delta: 0 atomic USDC
receiver delta: 0 atomic USDC
```

The positive settlement receipt was fetched from the job's signed `receipt.json` artifact URL and its transaction receipt was confirmed on Base Sepolia. The negative case uses a deterministic failing tempo constraint after payment verification. Direct Base Sepolia USDC balance reads for both buyer and receiver remained unchanged, so the no-charge assertion does not rely on Musicwire bookkeeping.

After the final dependency and regression-test changes, the committed opt-in test also passed:

```text
faucet: 0xcaeee242ca18a2273e8d5e8b9be7a1f9da2dbfad81e46577cffee142ded68526
MUSICWIRE_X402_E2E=1 MSCORE_BIN=mscore npm run test:x402-e2e
pass: Base Sepolia x402 buyer pays only after QC and receives a settlement-backed receipt
on-chain settlement: 0x26f1f4bc3c78f1d1ed9b1884f41e71284d12a43e6523f4a4ac03a4b3f3342b99
amount: 250000 atomic USDC to the receiving address
```

## `x402curl` interop attempt

Installed with `/Users/thatdudealso/.dotfiles/scripts/install-x402curl.sh`; installed version: `x402curl 0.2.0`.

`--data-binary @test/fixtures/two-bar-piano-render-request.json` preserves a raw JSON request body. A proxy transcript confirmed that x402curl receives Musicwire's v2 quote and sends a second request carrying `Payment-Signature`. The current 0.2.0 client did not complete the CDP-facilitated payment against this endpoint during this run. The signed retry ended before a job was accepted or settlement called. No x402curl test payment was settled.

This is a non-blocking third-party-client compatibility note. The required positive and negative money-movement proof is the Coinbase `@x402/fetch` run above. The README retains the x402curl Base Sepolia command for future client releases.
