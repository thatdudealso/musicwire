import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class JobStore {
  constructor(dataDirectory, idempotencyWindowHours = 24) {
    fs.mkdirSync(dataDirectory, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDirectory, 'musicwire.sqlite'));
    this.idempotencyWindowMs = Math.max(1, idempotencyWindowHours) * 3_600_000;
    this.db.exec(`
      PRAGMA journal_mode = TRUNCATE;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        input_xml TEXT NOT NULL,
        formats_json TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        price_usd TEXT NOT NULL,
        payment_json TEXT NOT NULL,
        qc_json TEXT,
        artifacts_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT NOT NULL,
        payer_identity TEXT NOT NULL,
        request_context TEXT NOT NULL,
        job_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (key, payer_identity, request_context)
      );
      CREATE TABLE IF NOT EXISTS payment_wallets (
        provider TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        address TEXT NOT NULL,
        network TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS validate_results (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT,
        payer_identity TEXT,
        request_context TEXT,
        http_status INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        payment_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(idempotency_key, payer_identity, request_context)
      );
      CREATE TABLE IF NOT EXISTS payment_authorizations (
        fingerprint TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        idempotency_key TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        network TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.migrateRenderIdempotencyIdentity();
    this.migrateValidateResultIdentity();
    this.expireIdempotencyKeys();
  }

  create(job, replayIdentity = null) {
    const existing = replayIdentity && this.getByRenderIdentity(replayIdentity);
    if (existing) return existing;
    this.db
      .prepare(
        `INSERT INTO jobs (id,state,input_xml,formats_json,constraints_json,facts_json,price_usd,payment_json,created_at,updated_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        job.id,
        'queued',
        job.inputXml,
        JSON.stringify(job.formats),
        JSON.stringify(job.constraints),
        JSON.stringify(job.facts),
        job.priceUsd,
        JSON.stringify(job.payment),
        job.createdAt,
        job.createdAt,
        job.expiresAt,
      );
    if (replayIdentity)
      this.db
        .prepare(
          `INSERT INTO idempotency_keys
           (key,payer_identity,request_context,job_id,created_at) VALUES (?,?,?,?,?)`,
        )
        .run(
          replayIdentity.idempotencyKey,
          replayIdentity.payerIdentity,
          replayIdentity.requestContext,
          job.id,
          job.createdAt,
        );
    return this.get(job.id);
  }

  getByRenderIdentity({ idempotencyKey, payerIdentity, requestContext }) {
    if (!idempotencyKey || !payerIdentity || !requestContext) return null;
    this.expireIdempotencyKeys();
    const existing = this.db
      .prepare(
        `SELECT job_id FROM idempotency_keys
         WHERE key = ? AND payer_identity = ? AND request_context = ?`,
      )
      .get(idempotencyKey, payerIdentity, requestContext);
    return existing ? this.get(existing.job_id) : null;
  }

  claimPaymentAuthorization({ fingerprint, endpoint, idempotencyKey, createdAt }) {
    if (!fingerprint) return { claimed: true };
    this.expireIdempotencyKeys();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO payment_authorizations
         (fingerprint,endpoint,idempotency_key,created_at) VALUES (?,?,?,?)`,
      )
      .run(fingerprint, endpoint, idempotencyKey ?? null, createdAt);
    if (result.changes === 1) return { claimed: true };
    return {
      claimed: false,
      authorization: this.db
        .prepare(
          'SELECT endpoint,idempotency_key FROM payment_authorizations WHERE fingerprint = ?',
        )
        .get(fingerprint),
    };
  }

  saveValidateResult({
    id,
    idempotencyKey,
    payerIdentity = null,
    requestContext = null,
    httpStatus,
    body,
    payment,
    createdAt,
  }) {
    this.db
      .prepare(
        `INSERT INTO validate_results
         (id,idempotency_key,payer_identity,request_context,http_status,body_json,payment_json,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        idempotencyKey ?? null,
        payerIdentity,
        requestContext,
        httpStatus,
        JSON.stringify(body),
        JSON.stringify(payment),
        createdAt,
      );
    return this.getValidateResultById(id);
  }

  getValidateResultById(id) {
    const row = this.db.prepare('SELECT * FROM validate_results WHERE id = ?').get(id);
    return row ? decodeValidateResult(row) : null;
  }

  getValidateResultByIdentity({ idempotencyKey, payerIdentity, requestContext }) {
    if (!idempotencyKey || !payerIdentity || !requestContext) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM validate_results
         WHERE idempotency_key = ? AND payer_identity = ? AND request_context = ?`,
      )
      .get(idempotencyKey, payerIdentity, requestContext);
    return row ? decodeValidateResult(row) : null;
  }

  updateValidateResult(id, { httpStatus, body, payment }) {
    const fields = [];
    const values = [];
    if (httpStatus !== undefined) {
      fields.push('http_status = ?');
      values.push(httpStatus);
    }
    if (body !== undefined) {
      fields.push('body_json = ?');
      values.push(JSON.stringify(body));
    }
    if (payment !== undefined) {
      fields.push('payment_json = ?');
      values.push(JSON.stringify(payment));
    }
    if (fields.length === 0) return this.getValidateResultById(id);
    this.db
      .prepare(`UPDATE validate_results SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values, id);
    return this.getValidateResultById(id);
  }

  listSettlementPending() {
    const pattern = '%"status":"settlement_pending"%';
    const jobs = this.db
      .prepare("SELECT id FROM jobs WHERE state = 'completed' AND payment_json LIKE ?")
      .all(pattern)
      .filter((row) => this.get(row.id).payment.status === 'settlement_pending')
      .map((row) => ({ kind: 'job', id: row.id }));
    const validations = this.db
      .prepare('SELECT id FROM validate_results WHERE payment_json LIKE ?')
      .all(pattern)
      .filter((row) => this.getValidateResultById(row.id).payment.status === 'settlement_pending')
      .map((row) => ({ kind: 'validate', id: row.id }));
    return [...jobs, ...validations];
  }

  getPaymentWallet(provider) {
    return (
      this.db.prepare('SELECT * FROM payment_wallets WHERE provider = ?').get(provider) ?? null
    );
  }

  savePaymentWallet({ provider, accountName, address, network }) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO payment_wallets (provider,account_name,address,network,created_at,updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(provider) DO UPDATE SET
           account_name = excluded.account_name,
           address = excluded.address,
           network = excluded.network,
           updated_at = excluded.updated_at`,
      )
      .run(provider, accountName, address, network, now, now);
    return this.getPaymentWallet(provider);
  }

  update(id, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.get(id);
    const sql = `UPDATE jobs SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    this.db.prepare(sql).run(...keys.map((key) => fields[key]), new Date().toISOString(), id);
    return this.get(id);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? decode(row) : null;
  }

  getSettledRenderByTransaction(txHash) {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE state = 'completed'
           AND json_extract(payment_json, '$.status') = 'settled'
           AND lower(json_extract(payment_json, '$.tx_hash')) = ?`,
      )
      .get(txHash);
    return row ? decode(row) : null;
  }

  createReview({ id, jobId, txHash, network, rating, comment, createdAt }) {
    const result = this.db
      .prepare(
        `INSERT INTO reviews (id,job_id,tx_hash,network,rating,comment,created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(tx_hash) DO NOTHING`,
      )
      .run(id, jobId, txHash, network, rating, comment, createdAt);
    return result.changes === 1 ? this.getReviewByTransaction(txHash) : null;
  }

  getReviewByTransaction(txHash) {
    const row = this.db.prepare('SELECT * FROM reviews WHERE tx_hash = ?').get(txHash);
    return row ? decodeReview(row) : null;
  }

  listReviews({ limit, offset }) {
    return this.db
      .prepare('SELECT * FROM reviews ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
      .map(decodeReview);
  }

  reviewStats() {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count, AVG(rating) AS average_rating FROM reviews')
      .get();
    return {
      count: Number(row.count),
      averageRating: row.average_rating === null ? null : Number(row.average_rating),
    };
  }

  recoverInterruptedJobs() {
    const rows = this.db.prepare("SELECT * FROM jobs WHERE state IN ('queued', 'running')").all();
    const update = this.db.prepare(
      'UPDATE jobs SET state = ?, qc_json = ?, error_json = ?, payment_json = ?, updated_at = ? WHERE id = ?',
    );
    const now = new Date().toISOString();
    for (const row of rows) {
      const payment = {
        ...JSON.parse(row.payment_json),
        status: 'failed_not_charged',
        reason: 'render_interrupted',
        captured_at: null,
      };
      const error = {
        code: 'render_interrupted',
        message: 'The service restarted before rendering completed.',
      };
      update.run(
        'failed_not_charged',
        JSON.stringify({ status: 'failed', ...error }),
        JSON.stringify(error),
        JSON.stringify(payment),
        now,
        row.id,
      );
    }
    return rows.length;
  }

  expireIdempotencyKeys() {
    const cutoff = new Date(Date.now() - this.idempotencyWindowMs).toISOString();
    this.db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff);
  }

  migrateValidateResultIdentity() {
    const columns = this.db.prepare('PRAGMA table_info(validate_results)').all();
    if (columns.some((column) => column.name === 'payer_identity')) return;
    this.runMigration(`
      ALTER TABLE validate_results RENAME TO legacy_validate_results;
      CREATE TABLE validate_results (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT,
        payer_identity TEXT,
        request_context TEXT,
        http_status INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        payment_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(idempotency_key, payer_identity, request_context)
      );
      INSERT INTO validate_results
        (id,idempotency_key,payer_identity,request_context,http_status,body_json,payment_json,created_at)
      SELECT id,idempotency_key,'legacy','legacy:' || id,http_status,body_json,payment_json,created_at
      FROM legacy_validate_results;
      DROP TABLE legacy_validate_results;
    `);
  }

  migrateRenderIdempotencyIdentity() {
    const columns = this.db.prepare('PRAGMA table_info(idempotency_keys)').all();
    if (columns.some((column) => column.name === 'payer_identity')) return;
    this.runMigration(`
      ALTER TABLE idempotency_keys RENAME TO legacy_idempotency_keys;
      CREATE TABLE idempotency_keys (
        key TEXT NOT NULL,
        payer_identity TEXT NOT NULL,
        request_context TEXT NOT NULL,
        job_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (key, payer_identity, request_context)
      );
      INSERT INTO idempotency_keys
        (key,payer_identity,request_context,job_id,created_at)
      SELECT key,'legacy','legacy:' || job_id,job_id,created_at
      FROM legacy_idempotency_keys;
      DROP TABLE legacy_idempotency_keys;
    `);
  }

  runMigration(sql) {
    try {
      this.db.exec(`BEGIN IMMEDIATE;${sql}COMMIT;`);
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // The transaction never opened, so there is nothing to roll back.
        // Always rethrow the original migration failure below.
      }
      throw error;
    }
  }
}

function decodeValidateResult(row) {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    payerIdentity: row.payer_identity,
    requestContext: row.request_context,
    httpStatus: row.http_status,
    body: JSON.parse(row.body_json),
    payment: JSON.parse(row.payment_json),
    createdAt: row.created_at,
  };
}

function decode(row) {
  return {
    ...row,
    inputXml: row.input_xml,
    formats: JSON.parse(row.formats_json),
    constraints: JSON.parse(row.constraints_json),
    facts: JSON.parse(row.facts_json),
    payment: JSON.parse(row.payment_json),
    qc: row.qc_json ? JSON.parse(row.qc_json) : null,
    artifacts: row.artifacts_json ? JSON.parse(row.artifacts_json) : [],
    error: row.error_json ? JSON.parse(row.error_json) : null,
  };
}

function decodeReview(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    txHash: row.tx_hash,
    network: row.network,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}
