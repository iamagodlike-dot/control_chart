#!/usr/bin/env bash
# Обновление сайта academyauto.ru: сборка + загрузка на сервер.
# Запуск:  ./deploy.sh   (из папки autoservice-gantt)
set -e

HOST="186.246.30.197"
KEY="$HOME/.ssh/academyauto_deploy"
WEBROOT="/var/www/academyauto"
DIR="$(cd "$(dirname "$0")" && pwd)/client"

echo "==> Сборка приложения..."
cd "$DIR"
npm run build

echo "==> Загрузка на сервер..."
COPYFILE_DISABLE=1 tar czf - -C "$DIR/dist" . \
  | ssh -i "$KEY" -o BatchMode=yes root@"$HOST" \
    "rm -rf $WEBROOT/* && tar xzf - -C $WEBROOT && chown -R www-data:www-data $WEBROOT"

echo "==> Готово! Открывайте https://app.academyauto.ru"
