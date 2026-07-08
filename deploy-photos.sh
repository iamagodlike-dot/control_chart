#!/usr/bin/env bash
# Обновление программы-приёмника фотографий на сервере.
# Запуск:  ./deploy-photos.sh   (из папки autoservice-gantt)
# Разовая настройка сервера (Node, папки, systemd, nginx) — см. photo-server/README.md
set -e

HOST="186.246.30.197"
KEY="$HOME/.ssh/academyauto_deploy"
APPDIR="/opt/academyauto-photos"
DIR="$(cd "$(dirname "$0")" && pwd)/photo-server"

echo "==> Загрузка кода приёмника на сервер..."
COPYFILE_DISABLE=1 tar czf - -C "$DIR" index.js package.json \
  | ssh -i "$KEY" -o BatchMode=yes root@"$HOST" \
    "mkdir -p $APPDIR && tar xzf - -C $APPDIR"

echo "==> Установка зависимостей и перезапуск службы..."
ssh -i "$KEY" -o BatchMode=yes root@"$HOST" \
  "cd $APPDIR && npm install --omit=dev --no-audit --no-fund && systemctl restart academyauto-photos && systemctl --no-pager status academyauto-photos | head -5"

echo "==> Готово! Проверка: curl -s https://app.academyauto.ru/api/photos/health"
