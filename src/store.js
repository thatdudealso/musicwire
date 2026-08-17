import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class JobStore {
  constructor(dataDirectory) {
    fs.mkdirSync(dataDirectory, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDirectory, 'musicwire.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
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
    `);
  }

  create(job, idempotencyKey) {
    if (idempotencyKey) {
      const existing = this.db.prepare('SELECT job_id FROM idempotency_keys WHERE key = ?').get(idempotencyKey);
      if (existing) return this.get(existing.job_id);
    }
    this.db.prepare(`INSERT INTO jobs (id,state,input_xml,formats_json,constraints_json,facts_json,price_usd,payment_json,created_at,updated_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(job.id, 'queued', job.inputXml, JSON.stringify(job.formats), JSON.stringify(job.constraints), JSON.stringify(job.facts), job.priceUsd, JSON.stringify(job.payment), job.createdAt, job.createdAt, job.expiresAt);
    if (idempotencyKey) this.db.prepare('INSERT INTO idempotency_keys (key, job_id, created_at) VALUES (?,?,?)').run(idempotencyKey, job.id, job.createdAt);
    return this.get(job.id);
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
