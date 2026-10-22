import type { KurierApi } from '@shared/ipc'

declare global {
  interface Window {
    kurier: KurierApi
  }
}

export {}
