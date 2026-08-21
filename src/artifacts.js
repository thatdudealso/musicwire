import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export class ArtifactStore {
  constructor(dataDirectory, signingSecret, retentionDays, { bucket = '', s3Client = null } = {}) {
    this.directory = path.join(dataDirectory, 'artifacts');
    this.signingSecret = signingSecret;
    this.retentionDays = retentionDays;
    this.bucket = bucket;
    this.s3 = bucket ? (s3Client ?? new S3Client({})) : null;
    if (!this.s3) fs.mkdirSync(this.directory, { recursive: true });
  }

  async put(name, bytes) {
    const hash = sha256(bytes);
    if (this.s3) {
      const storageKey = `artifacts/${hash}`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: bytes,
          ServerSideEncryption: 'AES256',
        }),
      );
      return { name, sha256: hash, bytes: bytes.length, storageKey };
    }
    const destination = path.join(this.directory, hash);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
    return { name, sha256: hash, bytes: bytes.length, storageKey: hash };
  }

  token(jobId, artifact, expires) {
    return crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${jobId}:${artifact.storageKey}:${expires}`)
      .digest('base64url');
  }

  isValidToken(jobId, artifact, expires, token) {
    if (!Number.isSafeInteger(Number(expires)) || Number(expires) < Date.now()) return false;
    const expected = this.token(jobId, artifact, expires);
    const actual = Buffer.from(token ?? '');
    const expectedBytes = Buffer.from(expected);
    return actual.length === expectedBytes.length && crypto.timingSafeEqual(expectedBytes, actual);
  }

  async read(artifact) {
    if (this.s3) {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: artifact.storageKey }),
      );
      if (!response.Body) throw new Error(`Artifact ${artifact.storageKey} was missing from S3.`);
      return Buffer.from(await response.Body.transformToByteArray());
    }
    return fs.readFileSync(path.join(this.directory, artifact.storageKey));
  }
}
