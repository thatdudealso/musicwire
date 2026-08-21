#!/usr/bin/env bash
set -euo pipefail
set +x

readonly REGION='us-east-1'
readonly ACCOUNT_ID='841162711749'
readonly REPOSITORY='musicwire'
readonly PUBLIC_IMAGE='ghcr.io/thatdudealso/musicwire'
readonly STACK='musicwire-production'
readonly RUNTIME_SECRET='musicwire/production/runtime'
readonly TEMPLATE='infra/musicwire-production.yaml'
readonly SECRETS_ENV_FILE="${MUSICWIRE_SECRETS_ENV_FILE:-$HOME/.config/ai-keys.env}"

require_command() {
  command -v "$1" >/dev/null || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command git
require_command node

axi() {
  npx -y aws-axi "$@" --region "$REGION"
}

if [[ ! -r "$SECRETS_ENV_FILE" ]]; then
  echo "Missing readable credentials file: $SECRETS_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SECRETS_ENV_FILE"
set +a

for credential in CDP_API_KEY_ID CDP_API_KEY_SECRET CDP_WALLET_SECRET; do
  if [[ -z "${!credential:-}" ]]; then
    echo "blocked: required credential $credential is missing from $SECRETS_ENV_FILE" >&2
    exit 1
  fi
done

secret_exists=false
if axi secretsmanager describe-secret --secret-id "$RUNTIME_SECRET" >/dev/null 2>&1; then
  secret_exists=true
  existing_secret="$(axi secretsmanager get-secret-value --secret-id "$RUNTIME_SECRET" --reveal --query SecretString)"
  ARTIFACT_SIGNING_SECRET="$(
    printf '%s' "$existing_secret" | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => (input += chunk));
      process.stdin.on("end", () => process.stdout.write(JSON.parse(input).ARTIFACT_SIGNING_SECRET ?? ""));
    '
  )"
fi

if [[ -z "${ARTIFACT_SIGNING_SECRET:-}" ]]; then
  ARTIFACT_SIGNING_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))")"
fi
export ARTIFACT_SIGNING_SECRET

secret_file="$(mktemp)"
trap 'rm -f "$secret_file"' EXIT
chmod 600 "$secret_file"

node -e '
  const fs = require("node:fs");
  const keys = ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET", "ARTIFACT_SIGNING_SECRET"];
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`blocked: the runtime secret payload is missing ${missing.join(", ")}`);
    process.exit(1);
  }
  fs.writeFileSync(process.argv[1], JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key]]))));
' "$secret_file"

if "$secret_exists"; then
  axi secretsmanager put-secret-value --secret-id "$RUNTIME_SECRET" --secret-string "file://$secret_file"
else
  axi secretsmanager create-secret --name "$RUNTIME_SECRET" --secret-string "file://$secret_file"
fi

fallback_registry="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
image_uri="${MUSICWIRE_IMAGE_URI:-}"
if [[ -z "$image_uri" ]]; then
  echo 'MUSICWIRE_IMAGE_URI is required. Publish the immutable AMD64 image with the build-production-image.yml GitHub Actions workflow first.' >&2
  exit 1
fi
if [[ "$image_uri" != "$PUBLIC_IMAGE:"* && "$image_uri" != "$fallback_registry/$REPOSITORY:"* ]]; then
  echo "MUSICWIRE_IMAGE_URI must point at $PUBLIC_IMAGE, or at the $fallback_registry/$REPOSITORY operator fallback" >&2
  exit 1
fi

runtime_secret_arn="$(axi secretsmanager describe-secret --secret-id "$RUNTIME_SECRET" --query 'ARN')"
axi cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ImageUri="$image_uri" RuntimeSecretArn="$runtime_secret_arn"

echo 'Deployment submitted. Check https://musicwire.5432wire.com/health after ECS reaches steady state.'
