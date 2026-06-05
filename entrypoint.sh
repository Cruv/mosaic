#!/bin/sh
# LinuxServer.io-style entrypoint: honor TZ + PUID/PGID, then run as that user
# instead of root (su-exec accepts numeric uid:gid, so this works even when the
# named user can't be created). Keeps Mosaic consistent with my other stacks.
set -e

export TZ="${TZ:-Etc/UTC}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  addgroup -g "$PGID" mosaic 2>/dev/null || true
  adduser -D -H -u "$PUID" -G mosaic mosaic 2>/dev/null || true
  # Only relevant if a writable volume is added later; harmless otherwise.
  [ -d /config ] && chown -R "$PUID:$PGID" /config 2>/dev/null || true
  exec su-exec "$PUID:$PGID" node dist/index.js
fi

# Already non-root (e.g. user: directive) — just run.
exec node dist/index.js
