#!/usr/bin/env sh
set -eu
docker compose down -v
find data -type f ! -name .gitkeep -delete
