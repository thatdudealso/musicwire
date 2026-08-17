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
const artifactSigningSecret = process.env.ARTIFACT_SIGNING_SECRET ?? developmentArtifactSigningSecret;

if (process.env.NODE_ENV === 'production' && (!artifactSigningSecret.trim() || artifactSigningSecret === developmentArtifactSigningSecret)) {
  throw new Error('ARTIFACT_SIGNING_SECRET must be explicitly set to a non-development value in production.');
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
  audioTailAllowanceSeconds: decimal('AUDIO_TAIL_ALLOWANCE_SECONDS', 2),
  healthCacheSeconds: integer('HEALTH_CACHE_SECONDS', 30),
  validatePriceUsd: process.env.VALIDATE_PRICE_USD ?? '0.10',
  renderSoloPriceUsd: process.env.RENDER_SOLO_PRICE_USD ?? '0.25',
  renderMultiPriceUsd: process.env.RENDER_MULTI_PRICE_USD ?? '0.50',
  requestsPerMinute: integer('REQUESTS_PER_MINUTE', 60),
};

export const supportedFormats = ['mscz', 'pdf', 'svg', 'png', 'midi', 'mp3', 'wav'];
