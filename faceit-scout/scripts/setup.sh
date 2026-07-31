#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists"
fi

mkdir -p \
  data/incoming \
  data/processing \
  data/completed \
  data/failed \
  data/decompressed \
  data/temporary

echo "Data folders are ready"
echo "Next: docker compose up -d --build"
