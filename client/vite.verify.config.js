// Временный конфиг для проверки БОЕВОЙ сборки демо-страницы редактора документов
// (production React ведёт себя иначе, чем dev — проверяем фикс раскрывашек именно
// в той сборке, что уходит в прод). Не для деплоя: собирает в dist-verify.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-verify',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        demo: resolve(import.meta.dirname, 'doceditor-demo.html'),
      },
    },
  },
  preview: { port: 5177 },
});
