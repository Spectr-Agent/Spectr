#!/usr/bin/env bash
# Deploys a new version of the call agent to LiveKit Cloud (agent CA_MqsA9odeGLc5).
#
# The agent imports code from services/api, so the build context must hold both
# packages. This stages committed files from HEAD into a temp folder and deploys it;
# uncommitted changes are not deployed. Needs the lk CLI and LIVEKIT_URL,
# LIVEKIT_API_KEY, LIVEKIT_API_SECRET in the environment.
#
# Secrets live on LiveKit Cloud, not here. To change them:
#   lk agent update-secrets --secrets-file <file>   (run inside the staged folder)
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
here="$repo/services/call-agent/deploy"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

git -C "$repo" archive HEAD services/api services/call-agent | tar -x -C "$stage"
mv "$stage"/services/* "$stage"/
rmdir "$stage/services"
rm -rf "$stage/call-agent/deploy"
cp "$here/Dockerfile" "$here/.dockerignore" "$here/package.json" "$here/livekit.toml" "$stage/"

cd "$stage"
lk agent deploy --yes .
lk agent status
