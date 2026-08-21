import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { failureCodes } from './qc.js';

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export class ArtifactStorageError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = 'ArtifactStorageError';
    this.code = code;
    this.expired = code === failureCodes.artifactExpired;
  }
}

function storageUnavailable(cause) {
  return new ArtifactStorageError(
    'Durable artifact storage is temporarily unavailable. Retry shortly.',
    { code: failureCodes.artifactStorage, cause },
  );
}

function artifactExpired(storageKey, cause) {
  return new ArtifactStorageError(
    `Artifact ${storageKey} is no longer stored. Rendered artifacts are retained for a limited window.`,
    { code: failureCodes.artifactExpired, cause },
  );
}

function isMissingObject(error) {
  return (
    error?.name === 'NoSuchKey' ||
    error?.name === 'NotFound' ||
    error?.Code === 'NoSuchKey' ||
    error?.code === 'ENOENT' ||
    error?.$metadata?.httpStatusCode === 404
  );
}

export class ArtifactStore {
  constructor(
    dataDirectory,
    signingSecret,
    retentionDays,
    { bucket = '', region = '', s3Client = null } = {},
  ) {
    this.directory = path.join(dataDirectory, 'artifacts');
    this.signingSecret = signingSecret;
    this.retentionDays = retentionDays;
    this.bucket = bucket;
    this.s3 = bucket ? (s3Client ?? new S3Client(region ? { region } : {})) : null;
    if (!this.s3) fs.mkdirSync(this.directory, { recursive: true });
  }

  async put(name, bytes) {
    const hash = sha256(bytes);
    try {
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
      if (!fs.existsSync(destination)) writeContentAddressedFile(destination, bytes);
      return { name, sha256: hash, bytes: bytes.length, storageKey: hash };
    } catch (error) {
      throw storageUnavailable(error);
    }
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
    try {
      if (this.s3) {
        const response = await this.s3.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: artifact.storageKey }),
        );
        if (!response.Body) throw artifactExpired(artifact.storageKey);
        return Buffer.from(await response.Body.transformToByteArray());
      }
      return fs.readFileSync(path.join(this.directory, artifact.storageKey));
    } catch (error) {
      if (error instanceof ArtifactStorageError) throw error;
      if (isMissingObject(error)) throw artifactExpired(artifact.storageKey, error);
      throw storageUnavailable(error);
    }
  }
}

function writeContentAddressedFile(destination, bytes) {
  try {
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}
