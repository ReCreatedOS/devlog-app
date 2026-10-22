/// <reference types="vite/client" />

import type { DevlogApi } from '../../shared/ipc.js'

declare global {
  interface Window {
    devlog: DevlogApi
  }
}

export {}
