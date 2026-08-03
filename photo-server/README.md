# Приёмник фотографий (photo-server)

Маленькая программа, которая принимает фото автомобилей от приложения и кладёт их
на диск сервера. Нужна потому, что Firebase Storage требует платный план Blaze с
картой (российские карты не проходят), а nginx сам загрузки принимать не умеет.

**Как это работает:** телефон сжимает снимок → шлёт на `app.academyauto.ru/api/photos/…`
с токеном входа → nginx проксирует на эту программу (порт 4300) → она проверяет
токен по публичным сертификатам Google и сохраняет файл в `/var/www/academyauto-uploads`.
Обратно nginx раздаёт фото по адресу `/uploads/…`. Секретных ключей на сервере нет.

> **Про отправку писем.** Она здесь была и работала, но с этого сервера закрыты все
> исходящие SMTP-порты (25/465/587/2525 — режет хостинг, проверено), поэтому код
> убран. Письма отправляют руками из Яндекс.Почты, а приложение готовит текст и
> архив с фото прямо в браузере (`client/src/photoZip.js`). Если хостер откроет
> порт 465, отправку допишем заново.

---

## Разовая настройка сервера (делается один раз)

Все команды — на сервере, под root: `ssh -i ~/.ssh/academyauto_deploy root@186.246.30.197`

### 1. Node.js (если ещё не стоит)
```bash
node -v   # если показывает версию 18+ — пропустите этот шаг
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

### 2. Папки
```bash
mkdir -p /opt/academyauto-photos          # сюда ляжет код программы
mkdir -p /var/www/academyauto-uploads     # сюда будут складываться фото
chown -R www-data:www-data /var/www/academyauto-uploads
```
> Важно: папка с фото **отдельная** от сайта. Сайт лежит в `/var/www/academyauto`,
> и при каждом обновлении приложения он полностью стирается — фото там бы пропали.

### 3. Код программы (первый раз — вручную; дальше скриптом, см. ниже)
С вашего компьютера, из папки `autoservice-gantt`:
```bash
scp -i ~/.ssh/academyauto_deploy -r photo-server/index.js photo-server/package.json \
    root@186.246.30.197:/opt/academyauto-photos/
```
Затем на сервере поставить зависимости:
```bash
cd /opt/academyauto-photos && npm install --omit=dev
```

### 4. Автозапуск (systemd)
Скопируйте файл службы и включите её:
```bash
scp -i ~/.ssh/academyauto_deploy photo-server/academyauto-photos.service \
    root@186.246.30.197:/etc/systemd/system/     # с вашего компьютера

# на сервере:
systemctl daemon-reload
systemctl enable --now academyauto-photos
systemctl status academyauto-photos             # должно быть "active (running)"
```

### 5. nginx
Откройте конфиг сайта (обычно `/etc/nginx/sites-available/app.academyauto.ru`) и
добавьте внутрь блока `server { … }` два `location` из файла
[`nginx-photos.conf`](./nginx-photos.conf). Затем:
```bash
nginx -t && systemctl reload nginx
```

### 6. Проверка
```bash
curl -s http://127.0.0.1:4300/health         # {"ok":true}
curl -s https://app.academyauto.ru/api/photos/health   # тоже {"ok":true} — значит nginx проксирует
```
Готово. Откройте карточку любой машины в приложении — там появится блок «Фото».

---

## Обновление кода программы (когда меняется index.js)

С вашего компьютера, из папки `autoservice-gantt`:
```bash
./deploy-photos.sh
```
Скрипт зальёт свежий код, доустановит зависимости и перезапустит службу.

---

## Бэкап фотографий

Фото лежат в `/var/www/academyauto-uploads`. Добавьте эту папку в резервное
копирование (простейший вариант — еженедельный архив на другой диск/сервер):
```bash
tar czf /root/uploads-backup-$(date +%F).tgz -C /var/www academyauto-uploads
```

## Диагностика
```bash
journalctl -u academyauto-photos -n 50 --no-pager   # логи программы
systemctl restart academyauto-photos                # перезапуск, если зависла
df -h /var/www                                       # сколько места на диске
```
