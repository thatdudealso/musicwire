import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('production deploy accepts aws-axi labeled Secrets Manager query results', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-deploy-'));
  const secretsFile = path.join(temporaryDirectory, 'credentials.env');
  const npxFile = path.join(temporaryDirectory, 'npx');

  fs.writeFileSync(
    secretsFile,
    [
      'CDP_API_KEY_ID=test-key-id',
      'CDP_API_KEY_SECRET=test-key-secret',
      'CDP_WALLET_SECRET=test-wallet-secret',
    ].join('\n'),
  );
  fs.writeFileSync(
    npxFile,
    `#!/usr/bin/env bash
set -euo pipefail
arguments="$*"
if [[ "$arguments" == *'secretsmanager describe-secret'* && "$arguments" == *'--query ARN'* ]]; then
  printf '%s\\n' 'secretsmanager: "arn:aws:secretsmanager:us-east-1:841162711749:secret:musicwire/production/runtime-test"'
elif [[ "$arguments" == *'secretsmanager describe-secret'* ]]; then
  exit 0
elif [[ "$arguments" == *'secretsmanager get-secret-value'* ]]; then
  printf '%s\\n' 'secretsmanager: "{\\"ARTIFACT_SIGNING_SECRET\\":\\"persisted-signing-secret\\"}"'
elif [[ "$arguments" == *'secretsmanager put-secret-value'* || "$arguments" == *'cloudformation deploy'* ]]; then
  exit 0
else
  printf 'Unexpected aws-axi invocation: %s\\n' "$arguments" >&2
  exit 1
fi
`,
  );
  fs.chmodSync(npxFile, 0o755);

  try {
    const output = execFileSync('bash', ['scripts/deploy-production.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        MUSICWIRE_SECRETS_ENV_FILE: secretsFile,
        MUSICWIRE_IMAGE_URI: 'ghcr.io/thatdudealso/musicwire:test-image',
        PATH: `${temporaryDirectory}:${process.env.PATH}`,
      },
    });

    assert.match(output, /Deployment submitted/);
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
