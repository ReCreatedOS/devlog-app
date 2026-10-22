import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Facets, QueryFilter, QueryResult } from '@devlog/core/shared'
import type { EntryDetail, LibraryStatus } from '../../../shared/ipc.js'

const EMPTY_FACETS: Facets = {
  types: {},
  sources: {},
  statuses: {},
  severities: {},
  tags: [],
  days: {},
}

/**
 * Ana süreçteki kütüphaneye tek giriş noktası.
 *
 * Dosya değişiklik olayları (ajanın yazdığı kayıtlar dâhil) `onChanged` ile
 * gelir ve sorguyu tazeler — bu yüzden UI'da manuel yenileme düğmesi yok.
 */
export function useLibrary(filter: QueryFilter) {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // Sorgu her tuş vuruşunda yeniden çalışır; sıralı olmayan yanıtların eskisini
  // yenisinin üstüne yazmasını engelliyoruz.
  const requestSeq = useRef(0)

  const serialized = JSON.stringify(filter)
  const stableFilter = useMemo(() => JSON.parse(serialized) as QueryFilter, [serialized])

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current
    const [nextResult, nextFacets, nextStatus] = await Promise.all([
      window.devlog.query(stableFilter, 500),
      window.devlog.facets(),
      window.devlog.status(),
    ])
    if (seq !== requestSeq.current) return
    setResult(nextResult)
    setFacets(nextFacets)
    setStatus(nextStatus)
    setLoading(false)
  }, [stableFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const offChanged = window.devlog.onChanged(() => void refresh())
    const offStatus = window.devlog.onStatusChanged(() => void refresh())
    return () => {
      offChanged()
      offStatus()
    }
  }, [refresh])

  return { result, facets, status, loading, refresh }
}

export function useEntryDetail(id: string | null) {
  const [detail, setDetail] = useState<EntryDetail | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setDetail(null)
      return
    }
    setDetail(await window.devlog.detail(id))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const off = window.devlog.onChanged((changedId) => {
      if (!changedId || changedId === id) void load()
    })
    return off
  }, [id, load])

  return { detail, reload: load }
}
