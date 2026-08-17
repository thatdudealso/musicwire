import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export class ArtifactStore {
  constructor(dataDirectory, signingSecret, retentionDays) {
    this.directory = path.join(dataDirectory, 'artifacts');
    this.signingSecret = signingSecret;
    this.retentionDays = retentionDays;
    fs.mkdirSync(this.directory, { recursive: true });
  }

  put(name, bytes) {
    const hash = sha256(bytes);
    const destination = path.join(this.directory, hash);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
    return { name, sha256: hash, bytes: bytes.length, storageKey: hash };
  }

  token(jobId, artifact, expires) {
    return crypto.createHmac('sha256', this.signingSecret).update(`${jobId}:${artifact.storageKey}:${expires}`).digest('base64url');
  }

  isValidToken(jobId, artifact, expires, token) {
    if (!Number.isSafeInteger(Number(expires)) || Number(expires) < Date.now()) return false;
    const expected = this.token(jobId, artifact, expires);
    const actual = Buffer.from(token ?? '');
    const expectedBytes = Buffer.from(expected);
    return actual.length === expectedBytes.length && crypto.timingSafeEqual(expectedBytes, actual);
  }

  read(artifact) {
    return fs.readFileSync(path.join(this.directory, artifact.storageKey));
  }
}
