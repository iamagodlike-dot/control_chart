#!/usr/bin/env bash
# Еженедельный бэкап фотографий автомобилей. Кладёт архив в /var/backups/academyauto
# и хранит последние 8 недельных копий (старые удаляются). Запускается таймером
# systemd (academyauto-backup.timer), вручную можно: systemctl start academyauto-backup
set -e

SRC_PARENT=/var/www
SRC_NAME=academyauto-uploads
DEST=/var/backups/academyauto
KEEP=8   # сколько недельных архивов хранить

mkdir -p "$DEST"
TS=$(date +%F)
ARCHIVE="$DEST/uploads-$TS.tgz"

tar czf "$ARCHIVE" -C "$SRC_PARENT" "$SRC_NAME"

# Ротация: оставляем KEEP самых свежих архивов, остальные удаляем.
ls -1t "$DEST"/uploads-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "Бэкап готов: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
