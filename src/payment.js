import { CdpClient } from '@coinbase/cdp-sdk';
import { createHash } from 'node:crypto';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import { x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';

const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const PAYMENT_WALLET_PROVIDER = 'cdp_server_wallet';
const AUTHORIZATION_STATE_SELECTOR = '0xe94a0102';
const AUTHORIZATION_USED_TOPIC =
  '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';

export class PaymentConfigurationError extends Error {}
export class PaymentVerificationError extends Error {}
export class PaymentSettlementError extends Error {
  constructor(message, { definitive = false } = {}) {
    super(message);
    this.definitive = definitive;
  }
}

export class PaymentService {
  constructor(gateway = new StubPaymentGateway()) {
    this.gateway = gateway;
  }

  async authorize({ request, endpoint, priceUsd, outputSchema }) {
    return this.gateway.authorize({ request, endpoint, priceUsd, outputSchema });
  }

  async createPendingCharge({ jobId, authorization }) {
    return {
      ...authorization,
      job_id: jobId,
      status: 'verified_pending_qc',
      captured_at: null,
      settled_at: null,
      tx_hash: null,
    };
  }

  async captureAfterQc(payment) {
    if (!['verified_pending_qc', 'settlement_pending'].includes(payment.status))
      throw new Error('Payment settlement is only permitted after verified pending QC.');
    return this.gateway.settle(payment);
  }

  async settleAfterQc(payment) {
    try {
      return { outcome: 'settled', payment: await this.captureAfterQc(payment) };
    } catch (error) {
      if (!(error instanceof PaymentSettlementError) || !error.definitive)
        return { outcome: 'pending', payment: settlementPendingPayment(payment) };
      return this.#resolveRefusedReconciliation(settlementPendingPayment(payment));
    }
  }

  async #resolveRefusedReconciliation(payment) {
    let evidence;
    try {
      evidence = (await this.gateway.findSettlement?.(payment)) ?? { outcome: 'unknown' };
    } catch {
      evidence = { outcome: 'unknown' };
    }
    if (evidence.outcome === 'settled') {
      const settledAt = new Date().toISOString();
      return {
        outcome: 'settled',
        payment: {
          ...payment,
          status: 'settled',
          tx_hash: evidence.tx_hash,
          network: evidence.network ?? payment.network,
          settled_at: settledAt,
          captured_at: settledAt,
        },
      };
    }
    if (evidence.outcome === 'not_charged')
      return {
        outcome: 'failed',
        payment: await this.cancelNotCharged(payment, 'settlement_failed'),
      };
    return { outcome: 'pending', payment: settlementPendingPayment(payment) };
  }

  settlementIntent(payment) {
    return settlementPendingPayment(payment);
  }

  async cancelNotCharged(payment, reason) {
    return this.gateway.cancel(payment, reason);
  }

  authorizationFingerprint(payment) {
    return payment.authorization_fingerprint ?? null;
  }

  publicPayment(payment) {
    const safe = { ...payment };
    delete safe.authorization_fingerprint;
    delete safe.payment_payload;
    delete safe.payment_requirements;
    delete safe.settlement_response;
    return safe;
  }

  settlementHeader(payment) {
    return payment.settlement_response
      ? encodePaymentResponseHeader(payment.settlement_response)
      : null;
  }

  receipt(payment) {
    return {
      status: payment.status,
      provider: payment.provider,
      amount_usd: payment.amount_usd,
      amount_atomic: payment.amount_atomic ?? null,
      asset: payment.asset ?? null,
      network: payment.network ?? null,
      pay_to: payment.pay_to ?? null,
      payer: payment.payer ?? null,
      tx_hash: payment.tx_hash ?? null,
      settled_at: payment.settled_at ?? null,
      reason: payment.reason ?? null,
    };
  }

  async description() {
    return this.gateway.description();
  }
}

export function createPaymentService(config, store) {
  if (config.paymentMode === 'x402')
    return new PaymentService(new CdpX402Gateway({ config, store }));
  return new PaymentService(new StubPaymentGateway({ config }));
}

export class CdpReceiverWallet {
  constructor({ config, store, clientFactory = () => new CdpClient() }) {
    this.config = config;
    this.store = store;
    this.clientFactory = clientFactory;
    this.addressPromise = null;
  }

  async address() {
    this.addressPromise ??= this.#resolveAddress().catch((error) => {
      this.addressPromise = null;
      throw error;
    });
    return this.addressPromise;
  }

  async #resolveAddress() {
    const saved = this.store.getPaymentWallet(PAYMENT_WALLET_PROVIDER);
    if (saved) {
      if (saved.network !== this.config.x402Network)
        throw new PaymentConfigurationError(
          `Stored receiving wallet is configured for ${saved.network}, but this deployment requires ${this.config.x402Network}.`,
        );
      return saved.address;
    }
    if (!process.env.CDP_WALLET_SECRET)
      throw new PaymentConfigurationError(
        'CDP_WALLET_SECRET is required to provision the Musicwire receiving wallet.',
      );
    const account = await this.clientFactory().evm.getOrCreateAccount({
      name: this.config.x402ReceiverWalletName,
    });
    if (!isEvmAddress(account.address))
      throw new PaymentConfigurationError('CDP returned an invalid EVM receiving address.');
    this.store.savePaymentWallet({
      provider: PAYMENT_WALLET_PROVIDER,
      accountName: this.config.x402ReceiverWalletName,
      address: account.address,
      network: this.config.x402Network,
    });
    console.info(`Musicwire ${this.config.x402Network} receiving address: ${account.address}`);
    return account.address;
  }
}

export class CdpX402Gateway {
  constructor({ config, store, wallet = new CdpReceiverWallet({ config, store }) }) {
    this.config = config;
    this.wallet = wallet;
    this.serverPromise = null;
  }

  async authorize({ request, endpoint, priceUsd, outputSchema }) {
    const { paymentRequired, requirements } = await this.#quote({
      request,
      endpoint,
      priceUsd,
    });
    const paymentSignature = request.get('payment-signature');
    if (!paymentSignature)
      return { authorized: false, challenge: challenge(paymentRequired, priceUsd, outputSchema) };
    const server = await this.#server();
    let paymentPayload;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentSignature);
    } catch {
      paymentPayload = null;
    }
    const matchedRequirements =
      paymentPayload && server.findMatchingRequirements(requirements, paymentPayload);
    if (!paymentPayload || !matchedRequirements)
      return {
        authorized: false,
        challenge: challenge(
          paymentRequired,
          priceUsd,
          outputSchema,
          'Payment does not match this quote.',
        ),
      };
    const authorizationFingerprint = paymentAuthorizationFingerprint(
      paymentPayload,
      matchedRequirements,
    );
    if (!authorizationFingerprint)
      return {
        authorized: false,
        challenge: challenge(
          paymentRequired,
          priceUsd,
          outputSchema,
          'Payment authorization is missing a valid payer and nonce.',
        ),
      };
    let verification;
    try {
      verification = await server.verifyPayment(paymentPayload, matchedRequirements);
    } catch {
      throw new PaymentVerificationError(
        'The Base facilitator could not verify this payment. No payment was settled.',
      );
    }
    if (!verification.isValid)
      return {
        authorized: false,
        challenge: challenge(
          paymentRequired,
          priceUsd,
          outputSchema,
          verification.invalidMessage ??
            verification.invalidReason ??
            'Payment verification failed.',
        ),
      };
    return {
      authorized: true,
      payment: pendingPayment({
        paymentPayload,
        requirements: matchedRequirements,
        verification,
        priceUsd,
        authorizationFingerprint,
      }),
    };
  }

  async settle(payment) {
    let result;
    try {
      result = await (
        await this.#server()
      ).settlePayment(payment.payment_payload, payment.payment_requirements);
    } catch (error) {
      throw new PaymentSettlementError(
        `The settlement outcome is unknown: ${error?.message ?? 'facilitator request failed'}.`,
        { definitive: false },
      );
    }
    if (!result.success)
      throw new PaymentSettlementError(
        result.errorMessage ?? result.errorReason ?? 'CDP facilitator refused to settle payment.',
        { definitive: true },
      );
    return {
      ...payment,
      status: 'settled',
      tx_hash: result.transaction,
      network: result.network,
      amount_atomic: result.amount ?? payment.amount_atomic,
      settled_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
      settlement_response: result,
    };
  }

  async cancel(payment, reason) {
    return failedPayment(payment, reason);
  }

  async findSettlement(payment) {
    const authorization = payment.payment_payload?.payload?.authorization;
    const asset = payment.payment_requirements?.asset;
    if (
      !isEvmAddress(authorization?.from) ||
      !isBytes32(authorization?.nonce) ||
      !isEvmAddress(asset)
    )
      return { outcome: 'unknown' };
    const rpc = new JsonRpcClient(this.config.x402RpcUrl);
    const state = await rpc.request('eth_call', [
      {
        to: asset,
        data: `${AUTHORIZATION_STATE_SELECTOR}${padTopic(authorization.from).slice(2)}${authorization.nonce.slice(2).toLowerCase()}`,
      },
      'latest',
    ]);
    if (BigInt(state) === 0n) {
      const latest = await rpc.request('eth_getBlockByNumber', ['latest', false]);
      if (Number(latest.timestamp) > Number(authorization.validBefore))
        return { outcome: 'not_charged' };
      return { outcome: 'unknown' };
    }
    const txHash = await findAuthorizationUsedTransaction(rpc, asset, authorization);
    if (txHash) return { outcome: 'settled', tx_hash: txHash, network: this.config.x402Network };
    return { outcome: 'unknown' };
  }

  async description() {
    return {
      provider: 'cdp',
      facilitator: 'https://api.cdp.coinbase.com/platform/v2/x402',
      network: this.config.x402Network,
      asset: 'USDC',
      pay_to: await this.wallet.address(),
    };
  }

  async #quote({ request, endpoint, priceUsd }) {
    const server = await this.#server();
    const payTo = await this.wallet.address();
    const requirements = await server.buildPaymentRequirements({
      scheme: 'exact',
      payTo,
      price: `$${priceUsd}`,
      network: this.config.x402Network,
      maxTimeoutSeconds: this.config.x402PaymentTimeoutSeconds,
    });
    const paymentRequired = await server.createPaymentRequiredResponse(requirements, {
      url: requestUrl(request, this.config.publicBaseUrl),
      description: endpointDescription(endpoint),
      mimeType: 'application/json',
      serviceName: 'Musicwire',
      tags: ['musicxml', 'rendering', 'qc'],
    });
    return { paymentRequired, requirements };
  }

  async #server() {
    this.serverPromise ??= (async () => {
      const server = new x402ResourceServer(createCdpFacilitatorClient()).register(
        this.config.x402Network,
        new ExactEvmScheme(),
      );
      await server.initialize();
      return server;
    })().catch((error) => {
      this.serverPromise = null;
      throw error;
    });
    return this.serverPromise;
  }
}

class JsonRpcClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
  }

  async request(method, params) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: (this.id += 1), method, params }),
    });
    if (!response.ok) throw new Error(`RPC ${method} failed with HTTP ${response.status}.`);
    const body = await response.json();
    if (body.error) throw new Error(body.error.message ?? `RPC ${method} failed.`);
    return body.result;
  }
}

async function findAuthorizationUsedTransaction(rpc, asset, authorization) {
  const latest = await rpc.request('eth_getBlockByNumber', ['latest', false]);
  const latestNumber = Number(latest.number);
  const latestTimestamp = Number(latest.timestamp);
  const validAfter = Number(authorization.validAfter);
  const validBefore = Number(authorization.validBefore);
  const blockTimestamp = async (number) =>
    Number(
      (await rpc.request('eth_getBlockByNumber', [`0x${number.toString(16)}`, false])).timestamp,
    );
  const firstBlockAtOrAfter = async (timestamp) => {
    let low = 0;
    let high = latestNumber;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((await blockTimestamp(middle)) < timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const fromBlock = await firstBlockAtOrAfter(validAfter);
  const toBlock =
    latestTimestamp <= validBefore ? latestNumber : await firstBlockAtOrAfter(validBefore + 1);
  const logs = await rpc.request('eth_getLogs', [
    {
      address: asset,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [
        AUTHORIZATION_USED_TOPIC,
        padTopic(authorization.from),
        authorization.nonce.toLowerCase(),
      ],
    },
  ]);
  return logs[0]?.transactionHash ?? null;
}

function padTopic(address) {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function isBytes32(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function paymentAuthorizationFingerprint(paymentPayload, requirements) {
  const authorization = paymentPayload?.payload?.authorization;
  if (
    !isEvmAddress(authorization?.from) ||
    !isBytes32(authorization?.nonce) ||
    !isEvmAddress(requirements.asset)
  )
    return null;
  return createHash('sha256')
    .update(
      `${requirements.network}:${requirements.asset.toLowerCase()}:${authorization.from.toLowerCase()}:${authorization.nonce.toLowerCase()}`,
    )
    .digest('hex');
}

export class StubPaymentGateway {
  constructor({ config = { x402Network: 'eip155:84532' } } = {}) {
    this.config = config;
  }

  async authorize({ request, endpoint, priceUsd, outputSchema }) {
    if (!request.get('payment-signature'))
      return {
        authorized: false,
        challenge: challenge(
          stubPaymentRequired({ endpoint, priceUsd, network: this.config.x402Network }),
          priceUsd,
          outputSchema,
        ),
      };
    const requirements = stubRequirements(priceUsd, this.config.x402Network);
    return {
      authorized: true,
      payment: {
        provider: 'stub',
        status: 'verified_pending_qc',
        amount_usd: priceUsd,
        amount_atomic: requirements.amount,
        asset: requirements.asset,
        network: requirements.network,
        pay_to: requirements.payTo,
        payer: 'test-payer',
        payment_payload: { stub: true },
        payment_requirements: requirements,
      },
    };
  }

  async settle(payment) {
    const settledAt = new Date().toISOString();
    return {
      ...payment,
      status: 'settled',
      tx_hash: 'stubbed-no-chain-transaction',
      settled_at: settledAt,
      captured_at: settledAt,
      settlement_response: {
        success: true,
        transaction: 'stubbed-no-chain-transaction',
        network: payment.network,
        amount: payment.amount_atomic,
      },
    };
  }

  async cancel(payment, reason) {
    return failedPayment(payment, reason);
  }

  async description() {
    return {
      provider: 'stub',
      network: this.config.x402Network,
      asset: 'USDC',
      pay_to: null,
    };
  }
}

function challenge(paymentRequired, priceUsd, outputSchema, error) {
  const required = error ? { ...paymentRequired, error } : paymentRequired;
  return {
    headers: {
      'payment-required': encodePaymentRequiredHeader(required),
      'cache-control': 'no-store',
    },
    body: {
      ...required,
      quote: {
        currency: 'USDC',
        price_usd: priceUsd,
        settlement: 'after_qc_pass',
        output_schema: outputSchema,
      },
    },
  };
}

function pendingPayment({
  paymentPayload,
  requirements,
  verification,
  priceUsd,
  authorizationFingerprint,
}) {
  return {
    provider: 'cdp_x402',
    status: 'verified_pending_qc',
    amount_usd: priceUsd,
    amount_atomic: requirements.amount,
    asset: requirements.asset,
    network: requirements.network,
    pay_to: requirements.payTo,
    payer: verification.payer ?? null,
    verified_at: new Date().toISOString(),
    authorization_fingerprint: authorizationFingerprint,
    payment_payload: paymentPayload,
    payment_requirements: requirements,
  };
}

function failedPayment(payment, reason) {
  return {
    ...payment,
    status: 'failed_not_charged',
    reason,
    tx_hash: null,
    settled_at: null,
    captured_at: null,
  };
}

function settlementPendingPayment(payment) {
  return {
    ...payment,
    status: 'settlement_pending',
    tx_hash: null,
    settled_at: null,
    captured_at: null,
  };
}

function stubPaymentRequired({ endpoint, priceUsd, network }) {
  return {
    x402Version: 2,
    resource: {
      url: `http://musicwire.test/v1/${endpoint}`,
      description: endpointDescription(endpoint),
      mimeType: 'application/json',
      serviceName: 'Musicwire',
    },
    accepts: [stubRequirements(priceUsd, network)],
  };
}

function stubRequirements(priceUsd, network) {
  return {
    scheme: 'exact',
    network,
    asset: BASE_SEPOLIA_USDC,
    amount: usdToAtomic(priceUsd),
    payTo: '0x1111111111111111111111111111111111111111',
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' },
  };
}

function endpointDescription(endpoint) {
  return endpoint === 'validate'
    ? 'MusicXML validation with deterministic quality checks.'
    : 'MusicXML render with deterministic automated QC and artifacts.';
}

function requestUrl(request, publicBaseUrl) {
  const base = publicBaseUrl || `${request.protocol}://${request.get('host')}`;
  return new URL(request.originalUrl, base).toString();
}

function usdToAtomic(value) {
  const [whole, fractional = ''] = String(value).split('.');
  return `${whole}${fractional.padEnd(6, '0').slice(0, 6)}`.replace(/^0+(?=\d)/, '');
}

function isEvmAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}
