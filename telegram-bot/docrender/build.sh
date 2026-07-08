#!/bin/sh
# Пересобрать серверный рендер документов из компонентов сайта.
cd "$(dirname "$0")/.."
npx esbuild docrender/entry.jsx --bundle --platform=node --format=cjs --jsx=automatic --outfile=docrender/bundle.cjs --log-level=warning
