import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

/**
 * Сборка веб-режима: тот же код main-процесса, но с шимом Electron.
 * Результат — out/web/server.cjs, который поднимает HTTP+SSE сервер.
 */
export default defineConfig({
  ssr: { noExternal: true },
  resolve: {
    alias: [
      { find: /^electron$/, replacement: resolve(__dirname, 'src/web/electron-shim.ts') },
      { find: /^electron-updater$/, replacement: resolve(__dirname, 'src/web/updater-stub.ts') },
      { find: /^electron-log\/main$/, replacement: resolve(__dirname, 'src/web/log-stub.ts') },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: '@main', replacement: resolve(__dirname, 'src/main') }
    ]
  },
  build: {
    ssr: resolve(__dirname, 'src/web/server.ts'),
    outDir: 'out/web',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`)
      ],
      output: {
        format: 'cjs',
        entryFileNames: 'server.cjs'
      }
    }
  }
})
