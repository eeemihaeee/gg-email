/** Заглушка electron-updater для веб-режима: обновлениями управляет сервер развёртывания. */
export interface UpdateInfo {
  version: string
  releaseName?: string
  releaseNotes?: string
}

export const autoUpdater = {
  logger: null as unknown,
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowPrerelease: false,
  channel: 'stable',
  disableWebInstaller: false,
  on: (): void => undefined,
  setFeedURL: (): void => undefined,
  checkForUpdates: async (): Promise<null> => null,
  quitAndInstall: (): void => undefined
}
