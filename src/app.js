import crypto from 'node:crypto';
import express from 'express';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as defaultConfig, supportedFormats, x402NetworkLabel } from './config.js';
import { composeGuide } from './compose-guide.js';
import { validateMusicXml, scoreFacts } from './validate.js';
import { JobStore } from './store.js';
import { ArtifactStore, ArtifactStorageError, artifactContentType, sha256 } from './artifacts.js';
import {
  createPaymentService,
  PaymentConfigurationError,
  PaymentSettlementError,
  PaymentVerificationError,
  paymentPayerIdentity,
} from './payment.js';
import { Renderer } from './renderer.js';
import { failureCodes } from './qc.js';

export function createApp(overrides = {}) {
  const config = { ...defaultConfig, ...overrides };
  const store = new JobStore(config.dataDirectory, config.idempotencyWindowHours);
  const artifactStore = new ArtifactStore(
    config.dataDirectory,
    config.artifactSigningSecret,
    config.artifactRetentionDays,
    {
      bucket: config.artifactStorage === 's3' ? config.artifactBucket : '',
      region: config.artifactRegion,
      s3Client: overrides.s3Client,
      ...(overrides.presigner ? { presigner: overrides.presigner } : {}),
      downloadUrlTtlSeconds: config.artifactDownloadUrlTtlSeconds,
    },
  );
  const payments = overrides.payments ?? createPaymentService(config, store);
  const renderer = overrides.renderer ?? new Renderer(config, artifactStore);
  const app = express();
  const limiter = new Map();
  const inflightValidations = new Map();
  const reconciler = createSettlementReconciler({ store, payments, artifactStore, config });
  const queue = createRenderQueue(config.maxConcurrentRenders, config.maxPendingRenders, (id) =>
    processJob(id, { store, renderer, artifactStore, payments, reconciler }),
  );
  const readinessProbe =
    overrides.readinessProbe ??
    (() =>
      Promise.all([
        commandReady(
          config.mscoreBin,
          config.mscoreArch
            ? [`-${config.mscoreArch}`, config.mscoreBin, '--version']
            : ['--version'],
          config.mscoreArch ? 'arch' : config.mscoreBin,
        ),
        commandReady(config.ffprobeBin, ['-version']),
      ]));
  let readiness = null;
  let readinessCheck = null;
  store.recoverInterruptedJobs();
  for (const target of store.listSettlementPending()) reconciler.schedule(target);
  app.disable('x-powered-by');

  // Serve static landing page and docs - BEFORE the rate limiter and body parsers
  const staticDir = resolve(fileURLToPath(new URL('..', import.meta.url)), 'static');
  const sendStaticPage = (response, name) => {
    response.type('text/html').sendFile(name, { root: staticDir }, (error) => {
      if (!error || response.headersSent) return;
      response.status(error.code === 'ENOENT' ? 404 : 500).json({
        error: {
          code: 'static_page_unavailable',
          message: `The ${name} page could not be served.`,
        },
      });
    });
  };

  app.get('/', (_request, response) => sendStaticPage(response, 'index.html'));
  app.get('/docs', (_request, response) => sendStaticPage(response, 'docs.html'));
  app.use(express.static(staticDir, { index: false }));

  app.use(rateLimit(limiter, config));

  app.use(
    express.raw({
      type: ['application/xml', 'text/xml', 'application/vnd.recordare.musicxml+xml'],
      limit: config.maxUploadBytes,
      inflate: false,
    }),
  );
  app.use(express.json({ limit: config.maxUploadBytes, inflate: false }));

  app.get('/health', async (_request, response) => {
    if (!readiness || Date.now() - readiness.checkedAt >= config.healthCacheSeconds * 1_000) {
      readinessCheck ??= readinessProbe()
        .then(([rendererReady, ffprobeReady]) => {
          readiness = { checkedAt: Date.now(), rendererReady, ffprobeReady };
        })
        .finally(() => {
          readinessCheck = null;
        });
      await readinessCheck;
    }
    response.status(readiness.rendererReady && readiness.ffprobeReady ? 200 : 503).json({
      ok: readiness.rendererReady && readiness.ffprobeReady,
      renderer: { ready: readiness.rendererReady, executable: config.mscoreBin },
      ffprobe: { ready: readiness.ffprobeReady, executable: config.ffprobeBin },
    });
  });

  app.get('/manifest', (_request, response) => response.json(manifest(config)));
  app.get('/.well-known/x402', async (_request, response, next) => {
    try {
      response.json({
        ...manifest(config).payment,
        receiver: await payments.description(),
        endpoints: manifest(config).endpoints,
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/v1/compose-guide', (request, response) => response.json(composeGuide(request.query)));

  app.post('/v1/validate', async (request, response) => {
    const input = extractInput(request, config);
    if (input.error) return response.status(input.status).json(input.error);
    const idempotencyKey = request.get('Idempotency-Key');
    const authorization = await payments.authorize({
      request,
      endpoint: 'validate',
      priceUsd: config.validatePriceUsd,
      outputSchema: paymentOutputSchema('validate'),
    });
    if (!authorization.authorized) return sendPaymentChallenge(response, authorization.challenge);
    const replayIdentity = validateReplayIdentity(authorization.payment, input.musicxml, idempotencyKey);
    const replay = replayIdentity && store.getValidateResultByIdentity(replayIdentity);
    if (replay) return sendValidateResult(response, payments, replay);
    const execute = async () => {
      if (
        !claimPaymentAuthorization(
          store,
          payments,
          authorization.payment,
          'validate',
          idempotencyKey,
        )
      )
        return paymentAuthorizationReused();
      const validationBody = (validation, payment, extra = {}) => ({
        ...validation,
        price_usd: config.validatePriceUsd,
        ...extra,
        payment: payments.publicPayment(payment),
        receipt: payments.receipt(payment),
      });
      const validation = validateMusicXml(input.musicxml);
      if (!validation.valid) {
        const payment = await payments.cancelNotCharged(
          authorization.payment,
          failureCodes.validation,
        );
        const body = validationBody(validation, payment, { status: 'failed_not_charged' });
        if (!idempotencyKey) return { id: null, httpStatus: 422, body, payment };
        return store.saveValidateResult({
          id: crypto.randomUUID(),
          idempotencyKey,
          ...replayIdentity,
          httpStatus: 422,
          body,
          payment,
          createdAt: new Date().toISOString(),
        });
      }
      const intent = payments.settlementIntent(authorization.payment);
      const record = store.saveValidateResult({
        id: crypto.randomUUID(),
        idempotencyKey: idempotencyKey ?? null,
        ...replayIdentity,
        httpStatus: 200,
        body: validationBody(validation, intent),
        payment: intent,
        createdAt: new Date().toISOString(),
      });
      const settlement = await payments.settleAfterQc(intent);
      if (settlement.outcome === 'failed') {
        return store.updateValidateResult(record.id, {
          httpStatus: 502,
          body: {
            error: {
              code: 'payment_settlement_failed',
              message:
                'Settlement was definitively rejected after validation passed. No payment was charged.',
            },
          },
          payment: settlement.payment,
        });
      }
      if (settlement.outcome === 'pending') {
        reconciler.schedule({ kind: 'validate', id: record.id });
        return record;
      }
      return store.updateValidateResult(record.id, {
        body: validationBody(validation, settlement.payment),
        payment: settlement.payment,
      });
    };
    const inflightKey = replayIdentity && JSON.stringify(replayIdentity);
    let pending = inflightKey ? inflightValidations.get(inflightKey) : null;
    if (!pending) {
      pending = execute();
      if (inflightKey) {
        inflightValidations.set(inflightKey, pending);
        pending.finally(() => inflightValidations.delete(inflightKey)).catch(() => {});
      }
    }
    const outcome = await pending;
    if (outcome.challenge) return sendPaymentChallenge(response, outcome.challenge);
    return sendValidateResult(response, payments, outcome);
  });

  app.post('/v1/render', async (request, response) => {
    if (!request.is('application/json'))
      return response.status(415).json({
        error: {
          code: 'render_json_required',
          message:
            'Render requests must use application/json so formats and constraints can be specified.',
        },
      });
    const input = extractInput(request, config);
    if (input.error) return response.status(input.status).json(input.error);
    const validation = validateMusicXml(input.musicxml);
    if (!validation.valid)
      return response.status(422).json({
        status: 'failed_not_charged',
        error: {
          code: failureCodes.validation,
          message:
            'MusicXML validation failed. Use paid POST /v1/validate for line-level diagnostics.',
        },
        payment: { status: 'not_charged' },
      });
    const formats = request.body.formats;
    if (
      !Array.isArray(formats) ||
      formats.length === 0 ||
      formats.some((format) => !supportedFormats.includes(format)) ||
      new Set(formats).size !== formats.length
    )
      return response.status(400).json({
        error: {
          code: 'invalid_formats',
          message: `formats must be a non-empty unique array drawn from: ${supportedFormats.join(', ')}.`,
        },
      });
    const constraints =
      request.body.constraints_check === undefined ? {} : request.body.constraints_check;
    if (constraints === null || typeof constraints !== 'object' || Array.isArray(constraints))
      return response.status(400).json({
        error: { code: 'invalid_constraints', message: 'constraints_check must be an object.' },
      });
    const constraintError = invalidNumericConstraint(constraints);
    if (constraintError)
      return response
        .status(400)
        .json({ error: { code: 'invalid_constraints', message: constraintError } });
    const facts = scoreFacts(
      input.musicxml,
      config.maxPlaybackMeasures,
      config.maxPlaybackTempoEvents,
    );
    const requiresDurationModel =
      formats.some((format) => format === 'mp3' || format === 'wav') ||
      'tempo' in constraints ||
      'duration_seconds' in constraints;
    if (requiresDurationModel && (facts.scoreDurationSeconds <= 0 || facts.durationModelError))
      return response.status(422).json({
        status: 'failed_not_charged',
        error: {
          code: facts.durationModelError ? failureCodes.durationModel : failureCodes.scoreDuration,
          message:
            facts.durationModelError ??
            'Audio rendering and tempo or duration constraints require a positive computable score duration.',
        },
        payment: { status: 'not_charged' },
      });
    const priceUsd =
      facts.partCount > config.multiInstrumentPartBoundary
        ? config.renderMultiPriceUsd
        : config.renderSoloPriceUsd;
    const idempotencyKey = request.get('Idempotency-Key');
    let reservationReleased = true;
    let pendingPayment = null;
    try {
      const authorization = await payments.authorize({
        request,
        endpoint: 'render',
        priceUsd,
        outputSchema: paymentOutputSchema('render'),
      });
      if (!authorization.authorized) {
        return sendPaymentChallenge(response, authorization.challenge);
      }
      pendingPayment = authorization.payment;
      const replayIdentity = renderReplayIdentity(
        pendingPayment,
        input.musicxml,
        formats,
        constraints,
        idempotencyKey,
      );
      const existing = replayIdentity && store.getByRenderIdentity(replayIdentity);
      if (existing) return response.status(202).json(renderResponse(existing, config));
      if (!queue.reserve())
        return response.status(503).json({
          error: { code: 'render_queue_full', message: 'Render queue is full. Retry later.' },
        });
      reservationReleased = false;
      if (!claimPaymentAuthorization(store, payments, pendingPayment, 'render', idempotencyKey)) {
        queue.release();
        reservationReleased = true;
        return response.status(409).json(paymentAuthorizationReused().body);
      }
      const now = new Date();
      const job = {
        id: crypto.randomUUID(),
        inputXml: input.musicxml,
        formats,
        constraints,
        facts,
        priceUsd,
        payment: await payments.createPendingCharge({
          jobId: 'pending',
          authorization: pendingPayment,
        }),
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + config.artifactRetentionDays * 86_400_000,
        ).toISOString(),
      };
      job.payment.job_id = job.id;
      const record = store.create(job, replayIdentity);
      if (record.id === job.id) queue.enqueue(record.id);
      else {
        await payments.cancelNotCharged(pendingPayment, 'idempotent_request_replayed');
        queue.release();
      }
      reservationReleased = true;
      response.status(202).json(renderResponse(record, config));
    } catch (error) {
      if (!reservationReleased) queue.release();
      if (pendingPayment) await payments.cancelNotCharged(pendingPayment, 'request_not_queued');
      throw error;
    }
  });

  app.get('/v1/jobs/:id', (request, response) => {
    const job = store.get(request.params.id);
    if (!job)
      return response
        .status(404)
        .json({ error: { code: 'job_not_found', message: 'No job exists with this id.' } });
    setSettlementHeader(response, payments, job.payment);
    response.json(publicJob(job, artifactStore, payments));
  });

  app.get('/v1/artifacts/:jobId/:name', async (request, response, next) => {
    try {
      const job = store.get(request.params.jobId);
      const artifact = job?.artifacts.find((item) => item.name === request.params.name);
      if (
        !artifact ||
        !artifactStore.isValidToken(job.id, artifact, request.query.expires, request.query.token)
      )
        return response.status(403).json({
          error: { code: 'artifact_access_denied', message: 'Artifact URL is expired or invalid.' },
        });
      const downloadUrl = await artifactStore.downloadUrl(artifact);
      if (downloadUrl) return response.redirect(302, downloadUrl);
      const bytes = await artifactStore.read(artifact);
      response.type(artifactContentType(artifact.name)).send(bytes);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof PaymentConfigurationError)
      return response.status(503).json({
        error: { code: 'payment_unavailable', message: error.message },
      });
    if (error instanceof PaymentVerificationError)
      return response.status(503).json({
        error: { code: 'payment_verification_unavailable', message: error.message },
      });
    if (error instanceof PaymentSettlementError)
      return response.status(502).json({
        error: { code: 'payment_settlement_failed', message: error.message },
      });
    if (error.type === 'entity.too.large')
      return response.status(413).json({
        error: {
          code: 'input_too_large',
          message: `MusicXML may not exceed ${config.maxUploadBytes} bytes.`,
        },
      });
    if (error.type === 'encoding.unsupported')
      return response.status(415).json({
        error: {
          code: 'compressed_input_not_accepted',
          message: 'Compressed request bodies are not accepted.',
        },
      });
    if (error instanceof ArtifactStorageError)
      return response
        .status(error.expired ? 404 : 503)
        .json({ error: { code: error.code, message: error.message } });
    return response
      .status(400)
      .json({ error: { code: 'invalid_request', message: 'Request body could not be parsed.' } });
  });
  return app;
}

async function processJob(id, services) {
  try {
    await renderAndSettleJob(id, services);
  } catch (error) {
    console.error(`Musicwire render job ${id} failed unexpectedly.`, error);
    const job = services.store.get(id);
    if (job?.state === 'running') await failJobNotCharged(services, job, unexpectedFailure(error));
  }
}

function unexpectedFailure(error) {
  if (error instanceof ArtifactStorageError)
    return {
      code: failureCodes.artifactStorage,
      message: 'Durable artifact storage was unavailable, so no payment was captured.',
    };
  return {
    code: failureCodes.unexpected,
    message: 'The render job failed unexpectedly, so no payment was captured.',
  };
}

async function failJobNotCharged(services, job, error) {
  const payment = await services.payments.cancelNotCharged(job.payment, error.code);
  services.store.update(job.id, {
    state: 'failed_not_charged',
    qc_json: JSON.stringify({ status: 'failed', ...error }),
    error_json: JSON.stringify(error),
    payment_json: JSON.stringify(payment),
  });
}

async function renderAndSettleJob(id, services) {
  const job = services.store.update(id, { state: 'running' });
  let result;
  try {
    result = await services.renderer.render(job);
  } catch (error) {
    if (error instanceof ArtifactStorageError) throw error;
    result = {
      ok: false,
      error: { code: failureCodes.renderer, message: 'Unexpected isolated renderer failure.' },
    };
  }
  if (!result.ok) {
    await failJobNotCharged(services, job, result.error);
    return;
  }
  const intent = services.payments.settlementIntent(job.payment);
  const receipt = {
    ...result.receipt,
    payment: services.payments.receipt(intent),
  };
  const artifacts = [
    ...result.artifacts,
    await services.artifactStore.put(
      'receipt.json',
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`),
    ),
  ];
  services.store.update(id, {
    state: 'completed',
    qc_json: JSON.stringify({
      status: 'passed',
      checks: [
        'validation',
        'renderer_exit',
        'artifacts_present',
        'audio_when_requested',
        'constraints_when_requested',
      ],
    }),
    artifacts_json: JSON.stringify(artifacts),
    payment_json: JSON.stringify(intent),
  });
  const settlement = await services.payments.settleAfterQc(intent);
  if (settlement.outcome === 'pending') {
    services.reconciler.schedule({ kind: 'job', id });
    return;
  }
  services.store.update(id, {
    payment_json: JSON.stringify(settlement.payment),
    artifacts_json: JSON.stringify(
      await refreshReceiptArtifactOrKeep(
        services.artifactStore,
        services.payments,
        artifacts,
        settlement.payment,
      ),
    ),
  });
}

async function refreshReceiptArtifactOrKeep(artifactStore, payments, artifacts, payment) {
  try {
    return await refreshReceiptArtifact(artifactStore, payments, artifacts, payment);
  } catch (error) {
    console.error('Musicwire could not rewrite receipt.json after settlement.', error);
    return artifacts;
  }
}

async function refreshReceiptArtifact(artifactStore, payments, artifacts, payment) {
  return Promise.all(
    artifacts.map(async (artifact) => {
      if (artifact.name !== 'receipt.json') return artifact;
      const receipt = JSON.parse((await artifactStore.read(artifact)).toString('utf8'));
      receipt.payment = payments.receipt(payment);
      return artifactStore.put(
        'receipt.json',
        Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`),
      );
    }),
  );
}

function createSettlementReconciler({ store, payments, artifactStore, config }) {
  const timers = new Map();
  const reconcileJob = async (id) => {
    const job = store.get(id);
    if (!job || job.payment.status !== 'settlement_pending') return true;
    const settlement = await payments.settleAfterQc(job.payment);
    if (settlement.outcome === 'pending') return false;
    store.update(id, {
      payment_json: JSON.stringify(settlement.payment),
      artifacts_json: JSON.stringify(
        await refreshReceiptArtifactOrKeep(
          artifactStore,
          payments,
          job.artifacts,
          settlement.payment,
        ),
      ),
    });
    return true;
  };
  const reconcileValidate = async (id) => {
    const record = store.getValidateResultById(id);
    if (!record || record.payment.status !== 'settlement_pending') return true;
    const settlement = await payments.settleAfterQc(record.payment);
    if (settlement.outcome === 'pending') return false;
    store.updateValidateResult(id, {
      body: {
        ...record.body,
        payment: payments.publicPayment(settlement.payment),
        receipt: payments.receipt(settlement.payment),
      },
      payment: settlement.payment,
    });
    return true;
  };
  const schedule = (target, attempt = 0) => {
    const key = `${target.kind}:${target.id}`;
    if (timers.has(key)) return;
    const delay = Math.min(300, config.x402SettlementRetrySeconds * 2 ** Math.min(attempt, 8));
    const timer = setTimeout(async () => {
      timers.delete(key);
      const settled = await (
        target.kind === 'job' ? reconcileJob(target.id) : reconcileValidate(target.id)
      ).catch(() => false);
      if (!settled) schedule(target, attempt + 1);
    }, delay * 1_000);
    timer.unref?.();
    timers.set(key, timer);
  };
  return { schedule };
}

function extractInput(request, config) {
  const value = request.is('application/json')
    ? request.body?.musicxml
    : request.body?.toString('utf8');
  if (typeof value !== 'string')
    return {
      status: 400,
      error: {
        error: {
          code: 'musicxml_required',
          message:
            'Send raw MusicXML bytes or JSON {"musicxml":"..."}; client filesystem paths are not accepted.',
        },
      },
    };
  if (Buffer.byteLength(value) > config.maxDecompressedBytes)
    return {
      status: 413,
      error: {
        error: {
          code: 'input_too_large',
          message: `MusicXML may not exceed ${config.maxDecompressedBytes} bytes.`,
        },
      },
    };
  return { musicxml: value };
}

function publicJob(job, artifactStore, payments) {
  const expires = new Date(job.expires_at).getTime();
  return {
    job_id: job.id,
    status: job.state,
    price_usd: job.price_usd,
    facts: job.facts,
    qc: job.qc,
    error: job.error,
    payment: payments.publicPayment(job.payment),
    receipt: payments.receipt(job.payment),
    expires_at: job.expires_at,
    artifacts: job.artifacts.map((artifact) => ({
      name: artifact.name,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      url: `/v1/artifacts/${job.id}/${encodeURIComponent(artifact.name)}?expires=${expires}&token=${artifactStore.token(job.id, artifact, expires)}`,
    })),
  };
}

function sendPaymentChallenge(response, challenge) {
  response.set(challenge.headers);
  return response.status(402).json(challenge.body);
}

function claimPaymentAuthorization(store, payments, payment, endpoint, idempotencyKey) {
  return store.claimPaymentAuthorization({
    fingerprint: payments.authorizationFingerprint(payment),
    endpoint,
    idempotencyKey,
    createdAt: new Date().toISOString(),
  }).claimed;
}

function paymentAuthorizationReused() {
  return {
    httpStatus: 409,
    body: {
      error: {
        code: 'payment_authorization_reused',
        message: 'This payment authorization is already bound to another request.',
      },
    },
    payment: { status: 'not_charged' },
  };
}

function sendValidateResult(response, payments, result) {
  setSettlementHeader(response, payments, result.payment);
  return response.status(result.httpStatus).json(result.body);
}

function setSettlementHeader(response, payments, payment) {
  const header = payments.settlementHeader(payment);
  if (header) response.set('payment-response', header);
}

function renderResponse(record, config) {
  return {
    job_id: record.id,
    status: record.state,
    estimated_seconds: Math.min(config.maxRenderSeconds, 15 + record.formats.length * 5),
    price_usd: record.price_usd,
    payment: { status: record.payment.status, capture_policy: 'capture_only_after_qc_pass' },
    poll_url: `/v1/jobs/${record.id}`,
  };
}

function rateLimit(limiter, config) {
  let lastSweepAt = 0;
  return (request, response, next) => {
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    if (now - lastSweepAt >= 60_000) {
      for (const [ip, timestamps] of limiter) {
        const active = timestamps.filter((time) => now - time < 60_000);
        if (active.length === 0) limiter.delete(ip);
        else if (active.length !== timestamps.length) limiter.set(ip, active);
      }
      lastSweepAt = now;
    }
    const current = limiter.get(key)?.filter((time) => now - time < 60_000) ?? [];
    if (current.length >= config.requestsPerMinute)
      return response.status(429).json({
        error: { code: 'rate_limited', message: 'Too many requests. Retry after one minute.' },
      });
    current.push(now);
    limiter.set(key, current);
    next();
  };
}

function createRenderQueue(maxConcurrentRenders, maxPendingRenders, run) {
  const pending = [];
  let active = 0;
  let reserved = 0;
  const limit = Math.max(1, Number.isSafeInteger(maxConcurrentRenders) ? maxConcurrentRenders : 1);
  const pendingLimit = Math.max(0, Number.isSafeInteger(maxPendingRenders) ? maxPendingRenders : 0);
  const drain = () => {
    while (active < limit && pending.length > 0) {
      const id = pending.shift();
      active += 1;
      setImmediate(async () => {
        try {
          await run(id);
        } catch (error) {
          console.error(`Musicwire render queue could not complete job ${id}.`, error);
        } finally {
          active -= 1;
          drain();
        }
      });
    }
  };
  return {
    reserve() {
      if (pending.length + reserved >= pendingLimit) return false;
      reserved += 1;
      return true;
    },
    release() {
      reserved = Math.max(0, reserved - 1);
    },
    enqueue(id) {
      reserved = Math.max(0, reserved - 1);
      pending.push(id);
      drain();
    },
  };
}

function invalidNumericConstraint(constraints) {
  const unsupported = Object.keys(constraints).find(
    (field) => !['tempo', 'duration_seconds', 'key_fifths', 'mode'].includes(field),
  );
  if (unsupported) return `${unsupported} is not a supported constraint.`;
  for (const field of ['tempo', 'duration_seconds']) {
    if (
      field in constraints &&
      (typeof constraints[field] !== 'number' ||
        !Number.isFinite(constraints[field]) ||
        constraints[field] <= 0)
    )
      return `${field} must be a finite positive number.`;
  }
  if (
    'key_fifths' in constraints &&
    (typeof constraints.key_fifths !== 'number' ||
      !Number.isFinite(constraints.key_fifths) ||
      !Number.isInteger(constraints.key_fifths))
  )
    return 'key_fifths must be a finite integer.';
  if ('mode' in constraints && !['major', 'minor'].includes(constraints.mode))
    return 'mode must be "major" or "minor".';
  return null;
}

async function commandReady(binary, args, executable = binary) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: 'ignore' });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 5_000);
    child.once('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

function manifest(config) {
  return {
    name: 'Musicwire',
    version: 'v1',
    payment: {
      protocol: 'x402',
      x402_version: 2,
      mode: config.paymentMode,
      network: config.x402Network,
      network_label: x402NetworkLabel(config.x402Network),
      asset: 'USDC',
      scheme: 'exact',
      facilitator: 'CDP',
      payment_required_header: 'PAYMENT-REQUIRED',
      payment_response_header: 'PAYMENT-RESPONSE',
      capture_policy: 'only_after_qc_pass',
      receipt_schema: {
        status: 'settled | settlement_pending | failed_not_charged',
        amount_usd: 'string',
        amount_atomic: 'string | null',
        network: config.x402Network,
        asset: 'EVM address | null',
        tx_hash: 'transaction hash | null',
        settled_at: 'ISO 8601 timestamp | null',
      },
      output_schemas: {
        validate: paymentOutputSchema('validate'),
        render: paymentOutputSchema('render'),
      },
    },
    endpoints: {
      compose_guide: { method: 'GET', path: '/v1/compose-guide', price_usd: '0.00' },
      validate: { method: 'POST', path: '/v1/validate', price_usd: config.validatePriceUsd },
      render: {
        method: 'POST',
        path: '/v1/render',
        price_usd: {
          solo: config.renderSoloPriceUsd,
          multi_instrument: config.renderMultiPriceUsd,
          part_boundary: config.multiInstrumentPartBoundary,
        },
      },
      jobs: { method: 'GET', path: '/v1/jobs/{id}', price_usd: '0.00' },
    },
    formats: {
      always: ['musicxml', 'NOTICE.txt', 'receipt.json'],
      requestable: supportedFormats,
      page_sets: ['svg', 'png'],
    },
    qc_guarantees: [
      'parse and semantic validation',
      'renderer exit code 0',
      'all requested artifacts present',
      'audio container, RMS, and score-duration check when audio is requested',
      'optional key, tempo, and duration constraint comparison',
      'failed jobs are failed_not_charged',
    ],
    failure_codes: failureCodes,
    retention: {
      minimum_days: config.artifactRetentionDays,
      storage:
        config.artifactStorage === 's3'
          ? 'content-addressed sha256 S3 storage'
          : 'content-addressed sha256 local storage',
      access: 'signed token URLs',
    },
    license_terms: {
      customer_owns_composition: true,
      commercial_audio_use_with_notice: true,
      rendered_by: 'Musicwire',
      copyright_sold: false,
      soundfont: 'MS Basic only',
    },
    abuse_terms: [
      'MusicXML bytes or strings only, no client filesystem paths.',
      'External entities, DOCTYPE declarations, compressed uploads, plugins, and custom soundfonts are disabled. The renderer performs no intentional network operations; strict egress control is a deploy-phase follow-up.',
      'Original, owned, or public-domain material only. Musicwire is not a copyrighted-melody transcription service.',
      'Rate limits and isolated resource-capped render workspaces apply.',
    ],
  };
}

function validateReplayIdentity(payment, musicxml, idempotencyKey) {
  return paymentReplayIdentity(payment, idempotencyKey, { musicxml }, 'validate');
}

function renderReplayIdentity(payment, musicxml, formats, constraints, idempotencyKey) {
  return paymentReplayIdentity(
    payment,
    idempotencyKey,
    { musicxml, formats, constraints },
    'render',
  );
}

function paymentReplayIdentity(payment, idempotencyKey, request, endpoint) {
  if (!idempotencyKey) return null;
  const payerIdentity = paymentPayerIdentity(payment);
  if (!payerIdentity)
    throw new PaymentVerificationError(
      'The verified payment did not provide a payer identity for idempotent replay.',
    );
  return {
    idempotencyKey,
    payerIdentity,
    requestContext: sha256(`${endpoint}:${JSON.stringify(canonicalRequest(request))}`),
  };
}

function canonicalRequest(value) {
  if (Array.isArray(value)) return value.map(canonicalRequest);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalRequest(value[key])]),
    );
  return value;
}

function paymentOutputSchema(endpoint) {
  if (endpoint === 'validate')
    return {
      status: '200 valid result | 422 failed_not_charged',
      fields: ['valid', 'errors', 'price_usd', 'payment', 'receipt'],
    };
  return {
    status: '202 queued render job',
    fields: ['job_id', 'status', 'estimated_seconds', 'price_usd', 'payment', 'poll_url'],
    completed_job_fields: ['qc', 'artifacts', 'receipt'],
  };
}
