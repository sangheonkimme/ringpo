#!/bin/sh
set -eu
mkdir -p /backups
echo "backup loop started (daily 03:00 KST, keep 7 days)"
while true; do
  if [ "$(date +%H%M)" = "0300" ]; then
    file="/backups/igc-$(date +%Y%m%d-%H%M).dump"
    if pg_dump -Fc -f "$file.tmp"; then
      mv "$file.tmp" "$file"
      echo "backup ok: $file"
    else
      rm -f "$file.tmp"
      echo "backup FAILED" >&2
    fi
    find /backups -name 'igc-*.dump' -mtime +7 -delete
    sleep 61
  fi
  sleep 30
done
