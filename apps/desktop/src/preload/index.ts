import { contextBridge, ipcRenderer } from 'electron'
import type {
  EntryDraft,
  EntryFrontmatter,
  Facets,
  QueryFilter,
  QueryResult,
  Entry,
  TrackingPatch,
} from '@devlog/core'
import { CHANNELS } from '../shared/ipc.js'
import type {
  AppSettings,
  CaptureOutcome,
  DevlogApi,
  EntryDetail,
  LibraryStatus,
  SaveOutcome,
  TeamActionOutcome,
} from '../shared/ipc.js'

function subscribe(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => callback(...args)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: DevlogApi = {
  query: (filter: QueryFilter, limit?: number, offset?: number) =>
    ipcRenderer.invoke(CHANNELS.query, filter, limit, offset) as Promise<QueryResult>,
  facets: () => ipcRenderer.invoke(CHANNELS.facets) as Promise<Facets>,
  detail: (id: string) => ipcRenderer.invoke(CHANNELS.detail, id) as Promise<EntryDetail | null>,
  create: (draft: EntryDraft) => ipcRenderer.invoke(CHANNELS.create, draft) as Promise<Entry>,
  save: (id: string, frontmatter: EntryFrontmatter, body: string, baseUpdatedAt?: string) =>
    ipcRenderer.invoke(CHANNELS.save, id, frontmatter, body, baseUpdatedAt) as Promise<SaveOutcome>,
  track: (id: string, patch: TrackingPatch) =>
    ipcRenderer.invoke(CHANNELS.track, id, patch) as Promise<Entry | null>,
  remove: (id: string) => ipcRenderer.invoke(CHANNELS.remove, id) as Promise<boolean>,
  status: () => ipcRenderer.invoke(CHANNELS.status) as Promise<LibraryStatus>,
  settings: () => ipcRenderer.invoke(CHANNELS.settings) as Promise<AppSettings>,
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(CHANNELS.updateSettings, patch) as Promise<AppSettings>,
  reindex: () => ipcRenderer.invoke(CHANNELS.reindex) as Promise<void>,
  resolve: (ids: string[]) =>
    ipcRenderer.invoke(CHANNELS.resolve, ids) as Promise<Record<string, boolean>>,
  reveal: (id: string) => ipcRenderer.invoke(CHANNELS.reveal, id) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.openExternal, url) as Promise<void>,
  onChanged: (callback) =>
    subscribe(CHANNELS.changed, (id) => callback(typeof id === 'string' ? id : undefined)),
  onStatusChanged: (callback) => subscribe(CHANNELS.statusChanged, () => callback()),
  sync: () => ipcRenderer.invoke(CHANNELS.sync) as Promise<void>,
  joinTeam: (request) =>
    ipcRenderer.invoke(CHANNELS.joinTeam, request) as Promise<TeamActionOutcome>,
  leaveTeam: (id) => ipcRenderer.invoke(CHANNELS.leaveTeam, id) as Promise<TeamActionOutcome>,
  onArrived: (callback) =>
    subscribe(CHANNELS.arrived, (ids) => {
      if (Array.isArray(ids)) callback(ids.filter((id): id is string => typeof id === 'string'))
    }),
  onFocusEntry: (callback) =>
    subscribe(CHANNELS.focusEntry, (id) => {
      if (typeof id === 'string') callback(id)
    }),
  onNewEntry: (callback) => subscribe(CHANNELS.newEntry, () => callback()),
  capture: {
    submit: (text: string) =>
      ipcRenderer.invoke(CHANNELS.captureSubmit, text) as Promise<CaptureOutcome>,
    close: () => ipcRenderer.send(CHANNELS.captureClose),
    resize: (height: number) => ipcRenderer.send(CHANNELS.captureResize, height),
    openMain: (id?: string) => ipcRenderer.send(CHANNELS.captureOpenMain, id),
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('devlog', api)
