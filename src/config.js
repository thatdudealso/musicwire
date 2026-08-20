import path from 'node:path';

const integer = (name, fallback) => {
  const value = process.env[name];
  return value === undefined ? fallback : Number.parseInt(value, 10);
};

const decimal = (name, fallback) => {
  const value = process.env[name];
  return value === undefined ? fallback : Number.parseFloat(value);
};

const developmentArtifactSigningSecret = 'development-only-change-before-deploy';
const baseSepoliaX402Network = 'eip155:84532';
const baseMainnetX402Network = 'eip155:8453';
const artifactSigningSecret =
  process.env.ARTIFACT_SIGNING_SECRET ?? developmentArtifactSigningSecret;

if (
  process.env.NODE_ENV === 'production' &&
  (!artifactSigningSecret.trim() || artifactSigningSecret === developmentArtifactSigningSecret)
) {
  throw new Error(
    'ARTIFACT_SIGNING_SECRET must be explicitly set to a non-development value in production.',
  );
}

export const config = {
  port: integer('PORT', 8787),
  dataDirectory: process.env.MUSICWIRE_DATA_DIR ?? path.resolve('data'),
  mscoreBin: process.env.MSCORE_BIN ?? 'mscore',
  mscoreArch: process.env.MSCORE_ARCH ?? (process.platform === 'darwin' ? 'arm64' : ''),
  ffprobeBin: process.env.FFPROBE_BIN ?? 'ffprobe',
  ffmpegBin: process.env.FFMPEG_BIN ?? 'ffmpeg',
  soundfontPath: process.env.MS_BASIC_SOUNDFONT ?? '',
  soundfontLicensePath: process.env.MS_BASIC_LICENSE ?? '',
  artifactSigningSecret,
  maxUploadBytes: integer('MAX_UPLOAD_BYTES', 1_000_000),
  maxDecompressedBytes: integer('MAX_DECOMPRESSED_BYTES', 1_000_000),
  maxRenderSeconds: integer('MAX_RENDER_SECONDS', 60),
  maxRenderCpuSeconds: integer('MAX_RENDER_CPU_SECONDS', 50),
  maxRenderRssKb: integer('MAX_RENDER_RSS_KB', 1_024_000),
  artifactRetentionDays: integer('ARTIFACT_RETENTION_DAYS', 30),
  multiInstrumentPartBoundary: integer('MULTI_INSTRUMENT_PART_BOUNDARY', 1),
  maxConcurrentRenders: integer('MAX_CONCURRENT_RENDERS', 1),
  maxPendingRenders: integer('MAX_PENDING_RENDERS', 20),
  maxPlaybackMeasures: integer('MAX_PLAYBACK_MEASURES', 20_000),
  maxPlaybackTempoEvents: integer('MAX_PLAYBACK_TEMPO_EVENTS', 20_000),
  audioTailAllowanceSeconds: decimal('AUDIO_TAIL_ALLOWANCE_SECONDS', 2),
  healthCacheSeconds: integer('HEALTH_CACHE_SECONDS', 30),
  validatePriceUsd: process.env.VALIDATE_PRICE_USD ?? '0.10',
  renderSoloPriceUsd: process.env.RENDER_SOLO_PRICE_USD ?? '0.25',
  renderMultiPriceUsd: process.env.RENDER_MULTI_PRICE_USD ?? '0.50',
  paymentMode: process.env.MUSICWIRE_PAYMENT_MODE ?? 'stub',
  x402Network: process.env.X402_NETWORK ?? baseSepoliaX402Network,
  x402PaymentTimeoutSeconds: integer('X402_PAYMENT_TIMEOUT_SECONDS', 300),
  x402SettlementRetrySeconds: decimal('X402_SETTLEMENT_RETRY_SECONDS', 5),
  x402RpcUrl: process.env.X402_RPC_URL ?? 'https://sepolia.base.org',
  x402ReceiverWalletName:
    process.env.MUSICWIRE_X402_RECEIVER_WALLET_NAME ?? 'musicwire-x402-receiver',
  publicBaseUrl: process.env.MUSICWIRE_PUBLIC_BASE_URL ?? '',
  idempotencyWindowHours: integer('IDEMPOTENCY_WINDOW_HOURS', 24),
  requestsPerMinute: integer('REQUESTS_PER_MINUTE', 60),
};

if (!['stub', 'x402'].includes(config.paymentMode))
  throw new Error('MUSICWIRE_PAYMENT_MODE must be either "stub" or "x402".');

if (process.env.NODE_ENV === 'production' && config.paymentMode !== 'x402')
  throw new Error('MUSICWIRE_PAYMENT_MODE=x402 is required in production.');

if (process.env.NODE_ENV === 'production' && !process.env.CDP_WALLET_SECRET?.trim())
  throw new Error('CDP_WALLET_SECRET is required for production x402 payments.');

if (process.env.NODE_ENV === 'production' && !process.env.CDP_API_KEY_ID?.trim())
  throw new Error('CDP_API_KEY_ID is required for production x402 payments.');

if (process.env.NODE_ENV === 'production' && !process.env.CDP_API_KEY_SECRET?.trim())
  throw new Error('CDP_API_KEY_SECRET is required for production x402 payments.');

if (process.env.NODE_ENV === 'production' && config.x402Network !== baseMainnetX402Network)
  throw new Error(`X402_NETWORK=${baseMainnetX402Network} is required in production.`);

if (process.env.NODE_ENV === 'production' && !isHttpsUrl(config.x402RpcUrl))
  throw new Error('X402_RPC_URL must be an HTTPS URL in production.');

export const supportedFormats = ['mscz', 'pdf', 'svg', 'png', 'midi', 'mp3', 'wav'];

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
