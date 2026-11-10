#!/bin/sh
set -eu
# Identical entry point for GitLab CI, GitHub Actions and local development.
npm ci
node --test scripts/prepare-sources.test.mjs
DOCS_RENDERER_PROJECTS_MANIFEST="$PWD/ci/projects.json" npm run build
