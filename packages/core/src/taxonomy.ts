import type { EntryStatus, EntryType, Severity } from './types.js'

/**
 * Görüntüleme sözlüğü. `taxonomy.yaml` vault içinde ajan için insan-okur
 * karşılığını tutar; buradaki tablo UI'ın etiket/renk kaynağıdır.
 */

export interface TypeMeta {
  /**
   * Liste satırındaki kısa rozet.
   *
   * Kodlar bilinçli olarak birbirine benzemiyor: eski sette `DEV`/`DEC`/`DEP`
   * üçü de üç harfli ve D ile başlıyordu, göz taramasında ayırt edilemiyorlardı.
   * Artık her kod ya farklı bir harfle başlıyor ya da farklı uzunlukta.
   */
  badge: string
  label: string
  /** Rozetin üstüne gelince çıkan tek cümle — sözlüğü ezberlemek gerekmesin. */
  description: string
}

export const TYPE_META: Record<EntryType, TypeMeta> = {
  incident: {
    badge: 'INC',
    label: 'Incident',
    description: 'Üretimde bir şey kırıldı ya da beklenmedik davrandı — severity zorunlu',
  },
  security: {
    badge: 'SEC',
    label: 'Güvenlik',
    description: 'Güvenlik bulgusu, zafiyet ya da sertleştirme çalışması — severity zorunlu',
  },
  devlog: {
    badge: 'LOG',
    label: 'Devlog',
    description: 'Günlük geliştirme notu — ne yapıldı, ne öğrenildi',
  },
  update: {
    badge: 'UPD',
    label: 'Güncelleme',
    description: 'Ürüne ya da bir özelliğe gelen, kullanıcıya görünen değişiklik',
  },
  idea: { badge: 'IDEA', label: 'Fikir', description: 'Ham fikir; henüz karar değil' },
  decision: {
    badge: 'DEC',
    label: 'Karar',
    description: 'Verilmiş karar ve gerekçesi — "neden böyle yapmıştık" sorusunun cevabı',
  },
  deploy: {
    badge: 'SHIP',
    label: 'Deploy',
    description: 'Bir ortama (test/prod) çıkış kaydı: ne, nereye, ne zaman',
  },
  commit: {
    badge: 'GIT',
    label: 'Commit',
    description: "Kod commit'i — genelde hook ile otomatik yakalanır",
  },
  meeting: {
    badge: 'MEET',
    label: 'Toplantı',
    description: 'Görüşmede konuşulanlar ve çıkan kararlar',
  },
  note: { badge: 'NOTE', label: 'Not', description: 'Diğer türlere girmeyen serbest not' },
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Kritik',
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
  info: 'Bilgi',
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  open: 'Açık',
  'in-progress': 'Devam ediyor',
  blocked: 'Bloke',
  verified: 'Doğrulandı',
  monitoring: 'İzlemede',
  fixed: 'Düzeltildi',
  done: 'Tamam',
  wontfix: 'Yapılmayacak',
}

/** Sol raydaki kayıtlı görünümler — filtre önayarları. */
export interface SavedView {
  id: string
  label: string
  /**
   * Görünüm hangi kipte açılmalı. Takip odaklı önayarları liste kipinde açmak
   * yanlış soruyu cevaplıyordu: "açık bulgular" tarih sırasında değil aciliyet
   * sırasında okunur.
   */
  view?: 'list' | 'tracker'
  filter: {
    types?: EntryType[]
    statuses?: EntryStatus[]
    severities?: Severity[]
    days?: number
    stale?: boolean
  }
}

export const SAVED_VIEWS: SavedView[] = [
  {
    id: 'tracking',
    label: 'Takipte olanlar',
    view: 'tracker',
    filter: { statuses: ['open', 'in-progress', 'blocked', 'monitoring'] },
  },
  {
    id: 'open-findings',
    label: 'Açık bulgular',
    view: 'tracker',
    filter: { types: ['security', 'incident'], statuses: ['open', 'in-progress', 'blocked'] },
  },
  {
    id: 'stale',
    label: 'Bayatlayanlar',
    view: 'tracker',
    filter: { stale: true },
  },
  { id: 'monitoring', label: 'İzlemede', view: 'tracker', filter: { statuses: ['monitoring'] } },
  { id: 'this-week', label: 'Bu hafta', view: 'list', filter: { days: 7 } },
]

/** Vault kökünde ajanın okuyacağı sözlük dosyası. */
export const TAXONOMY_YAML = `# devlog taksonomisi — uygulama ve ajan bu sözlüğü paylaşır.
# Bu dosyayı değiştirirsen packages/core/src/types.ts içindeki listeleri de güncelle.

type:
  incident:  Üretimde bir şey kırıldı ya da beklenmedik davrandı
  security:  Güvenlik bulgusu, zafiyet, sertleştirme
  devlog:    Günlük geliştirme notu, ne yapıldı
  update:    Ürün/özellik güncellemesi
  idea:      Ham fikir, henüz karar değil
  decision:  Verilmiş karar ve gerekçesi
  deploy:    Bir ortama çıkış kaydı
  commit:    Kod commit'i (genelde otomatik yakalanır)
  meeting:   Görüşme notu
  note:      Diğer

severity:   # incident ve security için ZORUNLU
  critical:  Sömürülebilir / veri kaybı / üretim durdu
  high:      Ciddi, hızlı müdahale gerek
  medium:    Önemli ama beklenebilir
  low:       Küçük
  info:      Bilgi amaçlı

status:
  open:         Açık, henüz ele alınmadı
  in-progress:  Üzerinde çalışılıyor
  blocked:      Başka bir şeyi bekliyor
  verified:     Canlıda doğrulandı
  monitoring:   Düzeltildi ama izleniyor
  fixed:        Düzeltildi
  done:         Tamamlandı
  wontfix:      Bilinçli olarak yapılmayacak

# area: serbest metin, ama tutarlı kal. Örnekler:
#   cdn, auth, billing, db, crm, inventory, review, hub, ci, infra

# TAKİP ALANLARI — bir konunun bugünkü hâli. Kayıt frontmatter'ında ya da
# salt-okunur aynalar için tracking/<id>.md dosyasında dururlar.
tracking:
  status_since:  Durumun en son değiştiği an. Bayatlık bunun üstünden ölçülür.
  next_action:   Sıradaki somut adım, tek cümle.
  next_review:   YYYY-MM-DD — bu gün gelince kayıt takip listesinin başına çıkar.
  pinned:        true ise takip listesinde yukarıda durur.

# Aktif durumlar (takip listesinde görünür): open, in-progress, blocked, monitoring
# Kapanmış durumlar: verified, fixed, done, wontfix
`
