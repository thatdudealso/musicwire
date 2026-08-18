import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { CdpX402Client } from '@coinbase/cdp-sdk/x402';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { wrapFetchWithPayment } from '@x402/fetch';
import { createPublicClient, erc20Abi, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createApp } from '../src/app.js';

const enabled = process.env.MUSICWIRE_X402_E2E === '1';
const baseSepoliaUsdc = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const receivingAddress = '0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f';
const rpc = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

test(
  'Base Sepolia x402 buyer pays only after QC and receives a settlement-backed receipt',
  { skip: !enabled, timeout: 120_000 },
  async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-x402-e2e-'));
    const app = createApp({
      dataDirectory,
      paymentMode: 'x402',
      publicBaseUrl: '',
      mscoreBin: process.env.MSCORE_BIN ?? 'mscore',
      mscoreArch: process.env.MSCORE_ARCH ?? (process.platform === 'darwin' ? 'arm64' : ''),
      requestTimeoutMs: 30_000,
      // Job polling plus payment requests can exceed the production 60/minute
      // rate limit while waiting for settlement reconciliation.
      requestsPerMinute: 10_000,
    });
    const server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const buyerClient = new CdpX402Client({
      environment: 'development',
      walletConfig: { type: 'eoa', accountName: 'musicwire-x402-e2e-buyer' },
    });
    const paidFetch = wrapFetchWithPayment(fetch, buyerClient);
    const buyer = (await buyerClient.getAddresses()).evmAddress;
    const musicxml = fs.readFileSync(
      new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
      'utf8',
    );
    const balanceOf = (address) =>
      rpc.readContract({
        address: baseSepoliaUsdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });
    const post = (body, idempotencyKey) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const waitForJob = async (jobId) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const response = await fetch(`${baseUrl}/v1/jobs/${jobId}`);
        const job = await response.json();
        if (job.status === 'failed_not_charged') return job;
        // An ambiguous facilitator settle response completes the job as
        // settlement_pending until reconciliation confirms it on-chain.
        if (job.status === 'completed' && job.payment.status !== 'settlement_pending') return job;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`Timed out waiting for job ${jobId}.`);
    };

    try {
      const renderRequest = { musicxml, formats: ['pdf'] };
      const quote = await fetch(`${baseUrl}/v1/render`, post(renderRequest, crypto.randomUUID()));
      assert.equal(quote.status, 402);
      const requirements = decodePaymentRequiredHeader(quote.headers.get('payment-required'));
      assert.equal(requirements.accepts[0].network, 'eip155:84532');
      assert.equal(requirements.accepts[0].amount, '250000');
      assert.equal(requirements.accepts[0].payTo.toLowerCase(), receivingAddress.toLowerCase());

      const beforeBuyer = await balanceOf(buyer);
      const beforeReceiver = await balanceOf(receivingAddress);
      assert.ok(beforeBuyer >= 250000n, 'Fund the buyer with at least 0.25 test USDC first.');
      const accepted = await paidFetch(
        `${baseUrl}/v1/render`,
        post(renderRequest, crypto.randomUUID()),
      );
      const acceptedBody = await accepted.json();
      assert.equal(accepted.status, 202, JSON.stringify(acceptedBody));
      const completed = await waitForJob(acceptedBody.job_id);
      assert.equal(completed.status, 'completed', JSON.stringify(completed));
      assert.equal(completed.payment.status, 'settled');
      assert.match(completed.receipt.tx_hash, /^0x[0-9a-f]{64}$/i);
      assert.equal(
        (await rpc.getTransactionReceipt({ hash: completed.receipt.tx_hash })).status,
        'success',
      );
      assert.equal(beforeBuyer - (await balanceOf(buyer)), 250000n);
      assert.equal((await balanceOf(receivingAddress)) - beforeReceiver, 250000n);

      const receiptArtifact = completed.artifacts.find(
        (artifact) => artifact.name === 'receipt.json',
      );
      assert.ok(receiptArtifact);
      const receipt = await (await fetch(`${baseUrl}${receiptArtifact.url}`)).json();
      assert.equal(receipt.payment.tx_hash, completed.receipt.tx_hash);

      const beforeFailedBuyer = await balanceOf(buyer);
      const beforeFailedReceiver = await balanceOf(receivingAddress);
      const rejected = await paidFetch(
        `${baseUrl}/v1/render`,
        post({ ...renderRequest, constraints_check: { tempo: 120 } }, crypto.randomUUID()),
      );
      const rejectedBody = await rejected.json();
      assert.equal(rejected.status, 202, JSON.stringify(rejectedBody));
      const failed = await waitForJob(rejectedBody.job_id);
      assert.equal(failed.status, 'failed_not_charged', JSON.stringify(failed));
      assert.equal(failed.receipt.tx_hash, null);
      assert.equal(await balanceOf(buyer), beforeFailedBuyer);
      assert.equal(await balanceOf(receivingAddress), beforeFailedReceiver);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  },
);
