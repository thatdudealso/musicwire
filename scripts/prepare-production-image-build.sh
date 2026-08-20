#!/usr/bin/env bash
set -euo pipefail
set +x

readonly REGION='us-east-1'
readonly REPOSITORY='musicwire'
readonly STACK='musicwire-image-build'
readonly TEMPLATE='infra/musicwire-image-build.yaml'
readonly GITHUB_REPOSITORY='thatdudealso/musicwire'

require_command() {
  command -v "$1" >/dev/null || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command npx
require_command gh-axi

axi() {
  npx -y aws-axi "$@" --region "$REGION"
}

if ! axi ecr describe-repositories --repository-names "$REPOSITORY" >/dev/null 2>&1; then
  axi ecr create-repository --repository-name "$REPOSITORY" --image-scanning-configuration scanOnPush=true
fi

axi cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM

role_arn="$(axi cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='ImageBuildRoleArn'].OutputValue")"
if [[ -z "$role_arn" ]]; then
  echo 'Could not resolve the GitHub Actions image-build role ARN.' >&2
  exit 1
fi

gh-axi variable set MUSICWIRE_ECR_BUILD_ROLE_ARN --body "$role_arn" --repo "$GITHUB_REPOSITORY"
echo 'GitHub Actions image publishing is ready. Dispatch build-production-image.yml with an immutable commit tag.'
