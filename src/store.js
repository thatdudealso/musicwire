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
        key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        created_at TEXT NOT NULL
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
        idempotency_key TEXT UNIQUE,
        http_status INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        payment_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payment_authorizations (
        fingerprint TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        idempotency_key TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.expireIdempotencyKeys();
  }

  create(job, idempotencyKey) {
    const existing = this.getByIdempotencyKey(idempotencyKey);
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
    if (idempotencyKey)
      this.db
        .prepare('INSERT INTO idempotency_keys (key, job_id, created_at) VALUES (?,?,?)')
        .run(idempotencyKey, job.id, job.createdAt);
    return this.get(job.id);
  }

  getByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    this.expireIdempotencyKeys();
    const existing = this.db
      .prepare('SELECT job_id FROM idempotency_keys WHERE key = ?')
      .get(idempotencyKey);
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

  saveValidateResult({ id, idempotencyKey, httpStatus, body, payment, createdAt }) {
    this.db
      .prepare(
        `INSERT INTO validate_results (id,idempotency_key,http_status,body_json,payment_json,created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        id,
        idempotencyKey ?? null,
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

  getValidateResultByKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    this.expireIdempotencyKeys();
    const row = this.db
      .prepare('SELECT * FROM validate_results WHERE idempotency_key = ?')
      .get(idempotencyKey);
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
    this.db.prepare('DELETE FROM payment_authorizations WHERE created_at < ?').run(cutoff);
    this.db
      .prepare(
        `DELETE FROM validate_results
         WHERE created_at < ? AND payment_json NOT LIKE '%"status":"settlement_pending"%'`,
      )
      .run(cutoff);
  }
}

function decodeValidateResult(row) {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
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
