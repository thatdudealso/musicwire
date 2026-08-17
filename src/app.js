import crypto from 'node:crypto';
import express from 'express';
import { spawn } from 'node:child_process';
import { config as defaultConfig, supportedFormats } from './config.js';
import { composeGuide } from './compose-guide.js';
import { validateMusicXml, scoreFacts } from './validate.js';
import { JobStore } from './store.js';
import { ArtifactStore } from './artifacts.js';
import { PaymentService } from './payment.js';
import { Renderer } from './renderer.js';
import { failureCodes } from './qc.js';

export function createApp(overrides = {}) {
  const config = { ...defaultConfig, ...overrides };
  const store = new JobStore(config.dataDirectory);
  const artifactStore = new ArtifactStore(config.dataDirectory, config.artifactSigningSecret, config.artifactRetentionDays);
  const payments = overrides.payments ?? new PaymentService();
  const renderer = overrides.renderer ?? new Renderer(config, artifactStore);
  const app = express();
  const limiter = new Map();
  app.disable('x-powered-by');
  app.use(rateLimit(limiter, config));
  app.use(express.raw({ type: ['application/xml', 'text/xml', 'application/vnd.recordare.musicxml+xml'], limit: config.maxUploadBytes, inflate: false }));
  app.use(express.json({ limit: config.maxUploadBytes, inflate: false }));

  app.get('/health', async (_request, response) => {
    const rendererReady = await commandReady(config.mscoreBin, config.mscoreArch ? [`-${config.mscoreArch}`, config.mscoreBin, '--version'] : ['--version'], config.mscoreArch ? 'arch' : config.mscoreBin);
    const ffprobeReady = await commandReady(config.ffprobeBin, ['-version']);
    response.status(rendererReady && ffprobeReady ? 200 : 503).json({ ok: rendererReady && ffprobeReady, renderer: { ready: rendererReady, executable: config.mscoreBin }, ffprobe: { ready: ffprobeReady, executable: config.ffprobeBin } });
  });

  app.get('/manifest', (_request, response) => response.json(manifest(config)));
  app.get('/v1/compose-guide', (request, response) => response.json(composeGuide(request.query)));

  app.post('/v1/validate', (request, response) => {
    const input = extractInput(request, config);
    if (input.error) return response.status(input.status).json(input.error);
    const validation = validateMusicXml(input.musicxml);
    response.status(validation.valid ? 200 : 422).json({ ...validation, price_usd: config.validatePriceUsd, payment: { provider: 'stub', status: 'configured_for_phase_2', charge_eligible: validation.valid } });
  });

  app.post('/v1/render', async (request, response) => {
    const input = extractInput(request, config);
    if (input.error) return response.status(input.status).json(input.error);
    const validation = validateMusicXml(input.musicxml);
    if (!validation.valid) return response.status(422).json({ status: 'failed_not_charged', error: { code: failureCodes.validation, message: 'MusicXML validation failed.', errors: validation.errors }, payment: { status: 'not_charged' } });
    const formats = request.is('application/json') ? request.body.formats ?? [] : [];
    if (!Array.isArray(formats) || formats.some((format) => !supportedFormats.includes(format)) || new Set(formats).size !== formats.length) return response.status(400).json({ error: { code: 'invalid_formats', message: `formats must be a unique array drawn from: ${supportedFormats.join(', ')}.` } });
    const constraints = request.is('application/json') && request.body.constraints_check ? request.body.constraints_check : {};
    if (typeof constraints !== 'object' || Array.isArray(constraints)) return response.status(400).json({ error: { code: 'invalid_constraints', message: 'constraints_check must be an object.' } });
    const facts = scoreFacts(input.musicxml);
    const priceUsd = facts.partCount > config.multiInstrumentPartBoundary ? config.renderMultiPriceUsd : config.renderSoloPriceUsd;
    const now = new Date();
    const job = {
      id: crypto.randomUUID(),
      inputXml: input.musicxml,
      formats,
      constraints,
      facts,
      priceUsd,
      payment: await payments.createPendingCharge({ jobId: 'pending', priceUsd }),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + config.artifactRetentionDays * 86_400_000).toISOString(),
    };
    job.payment.job_id = job.id;
    const record = store.create(job, request.get('Idempotency-Key'));
    if (record.id === job.id) setImmediate(() => processJob(record.id, { store, renderer, payments }));
    response.status(202).json({ job_id: record.id, status: record.state, estimated_seconds: Math.min(config.maxRenderSeconds, 15 + record.formats.length * 5), price_usd: record.price_usd, payment: { status: record.payment.status, capture_policy: 'capture_only_after_qc_pass' }, poll_url: `/v1/jobs/${record.id}` });
  });

  app.get('/v1/jobs/:id', (request, response) => {
    const job = store.get(request.params.id);
    if (!job) return response.status(404).json({ error: { code: 'job_not_found', message: 'No job exists with this id.' } });
    response.json(publicJob(job, artifactStore));
  });

  app.get('/v1/artifacts/:jobId/:name', (request, response) => {
    const job = store.get(request.params.jobId);
    const artifact = job?.artifacts.find((item) => item.name === request.params.name);
    if (!artifact || !artifactStore.isValidToken(job.id, artifact, request.query.expires, request.query.token)) return response.status(403).json({ error: { code: 'artifact_access_denied', message: 'Artifact URL is expired or invalid.' } });
    response.type(contentType(artifact.name)).send(artifactStore.read(artifact));
  });

  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.too.large') return response.status(413).json({ error: { code: 'input_too_large', message: `MusicXML may not exceed ${config.maxUploadBytes} bytes.` } });
    if (error.type === 'encoding.unsupported') return response.status(415).json({ error: { code: 'compressed_input_not_accepted', message: 'Compressed request bodies are not accepted.' } });
    return response.status(400).json({ error: { code: 'invalid_request', message: 'Request body could not be parsed.' } });
  });
  return app;
}

async function processJob(id, services) {
  const job = services.store.update(id, { state: 'running' });
  try {
    const result = await services.renderer.render(job);
    if (!result.ok) {
      const payment = await services.payments.cancelNotCharged(job.payment, result.error.code);
      services.store.update(id, { state: 'failed_not_charged', qc_json: JSON.stringify({ status: 'failed', ...result.error }), error_json: JSON.stringify(result.error), payment_json: JSON.stringify(payment) });
      return;
    }
    const payment = await services.payments.captureAfterQc(job.payment);
    services.store.update(id, { state: 'completed', qc_json: JSON.stringify({ status: 'passed', checks: ['validation', 'renderer_exit', 'artifacts_present', 'audio_when_requested', 'constraints_when_requested'] }), artifacts_json: JSON.stringify(result.artifacts), payment_json: JSON.stringify(payment) });
  } catch (error) {
    const payment = await services.payments.cancelNotCharged(job.payment, failureCodes.renderer);
    services.store.update(id, { state: 'failed_not_charged', qc_json: JSON.stringify({ status: 'failed', code: failureCodes.renderer, message: 'Unexpected isolated renderer failure.' }), error_json: JSON.stringify({ code: failureCodes.renderer, message: 'Unexpected isolated renderer failure.' }), payment_json: JSON.stringify(payment) });
  }
}

function extractInput(request, config) {
  const value = request.is('application/json') ? request.body?.musicxml : request.body?.toString('utf8');
  if (typeof value !== 'string') return { status: 400, error: { error: { code: 'musicxml_required', message: 'Send raw MusicXML bytes or JSON {"musicxml":"..."}; client filesystem paths are not accepted.' } } };
  if (Buffer.byteLength(value) > config.maxDecompressedBytes) return { status: 413, error: { error: { code: 'input_too_large', message: `MusicXML may not exceed ${config.maxDecompressedBytes} bytes.` } } };
  return { musicxml: value };
}

function publicJob(job, artifactStore) {
  const expires = new Date(job.expires_at).getTime();
  return {
    job_id: job.id,
    status: job.state,
    price_usd: job.price_usd,
    facts: job.facts,
    qc: job.qc,
    error: job.error,
    payment: job.payment,
    expires_at: job.expires_at,
    artifacts: job.artifacts.map((artifact) => ({ name: artifact.name, sha256: artifact.sha256, bytes: artifact.bytes, url: `/v1/artifacts/${job.id}/${encodeURIComponent(artifact.name)}?expires=${expires}&token=${artifactStore.token(job.id, artifact, expires)}` })),
  };
}

function rateLimit(limiter, config) {
  return (request, response, next) => {
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    const current = limiter.get(key)?.filter((time) => now - time < 60_000) ?? [];
    if (current.length >= config.requestsPerMinute) return response.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Retry after one minute.' } });
    current.push(now);
    limiter.set(key, current);
    next();
  };
}

async function commandReady(binary, args, executable = binary) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: 'ignore' });
    const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(false); }, 5_000);
    child.once('error', () => { clearTimeout(timeout); resolve(false); });
    child.once('close', (code) => { clearTimeout(timeout); resolve(code === 0); });
  });
}

function contentType(name) {
  if (name.endsWith('.musicxml')) return 'application/vnd.recordare.musicxml+xml';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

function manifest(config) {
  return {
    name: 'Musicwire', version: 'v1', payment: { phase: 'stub', future_402_response: { status: 402, detail: 'Payment Required. x402 verification and settlement land in Phase 2.' }, capture_policy: 'only_after_qc_pass' },
    endpoints: { compose_guide: { method: 'GET', path: '/v1/compose-guide', price_usd: '0.00' }, validate: { method: 'POST', path: '/v1/validate', price_usd: config.validatePriceUsd }, render: { method: 'POST', path: '/v1/render', price_usd: { solo: config.renderSoloPriceUsd, multi_instrument: config.renderMultiPriceUsd, part_boundary: config.multiInstrumentPartBoundary } }, jobs: { method: 'GET', path: '/v1/jobs/{id}', price_usd: '0.00' } },
    formats: { always: ['musicxml', 'NOTICE.txt', 'receipt.json'], requestable: supportedFormats, page_sets: ['svg', 'png'] },
    qc_guarantees: ['parse and semantic validation', 'renderer exit code 0', 'all requested artifacts present', 'audio container, RMS, and score-duration check when audio is requested', 'optional key, tempo, and duration constraint comparison', 'failed jobs are failed_not_charged'],
    failure_codes: failureCodes, retention: { minimum_days: config.artifactRetentionDays, storage: 'content-addressed sha256 local storage', access: 'signed token URLs' },
    license_terms: { customer_owns_composition: true, commercial_audio_use_with_notice: true, rendered_by: 'Musicwire', copyright_sold: false, soundfont: 'MS Basic only' },
    abuse_terms: ['MusicXML bytes or strings only, no client filesystem paths.', 'External entities, DOCTYPE declarations, compressed uploads, plugins, custom soundfonts, and networked rendering are disabled.', 'Original, owned, or public-domain material only. Musicwire is not a copyrighted-melody transcription service.', 'Rate limits and isolated resource-capped render workspaces apply.'],
  };
}
