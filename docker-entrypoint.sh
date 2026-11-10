#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  set -- docs-renderer preview
fi

exec "$@"
