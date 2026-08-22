import crypto from 'node:crypto';

export function verificationUrl(publicBaseUrl = '') {
  return `${publicBaseUrl.replace(/\/$/, '')}/v1/provenance/verify`;
}

export function signedRenderReceipt({ id, renderedAt, artifacts, signingSecret, publicBaseUrl }) {
  const receipt = {
    receipt_id: id,
    rendered_by: 'Musicwire',
    verification_url: verificationUrl(publicBaseUrl),
    rendered_at: renderedAt,
    artifacts: artifacts.map(({ name, sha256: hash, bytes }) => ({ name, sha256: hash, bytes })),
  };
  return {
    ...receipt,
    signature: crypto
      .createHmac('sha256', signingKey(signingSecret))
      .update(canonicalJson(receipt))
      .digest('base64url'),
    signature_algorithm: 'HMAC-SHA-256',
  };
}

function signingKey(secret) {
  return crypto.createHmac('sha256', secret).update('musicwire-render-receipt-v1').digest();
}

function canonicalJson(value) {
  return JSON.stringify(value);
}
