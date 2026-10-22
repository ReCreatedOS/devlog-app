import { createEntry, loadConfig } from '@devlog/core'
import { listTranscripts, readTranscript, sessionChanged, sessionDraft } from '../sessions.js'
import { alreadyLogged, note, readHookPayload, runHook } from './shared.js'

/**
 * SessionEnd hook'u — bir Claude Code oturumundan tek bir seyir defteri kaydı.
 *
 * Özet için ek bir model çağrısı YOK: Claude Code transcript'e zaten `ai-title`
 * yazıyor, gövdeyi de kullanıcının kendi promptları + dokunulan dosyalar +
 * commit'ler oluşturuyor. Böylece hook ucuz ve deterministik kalıyor.
 *
 * Eşik: yalnız BİR ŞEY DEĞİŞTİREN oturumlar kaydedilir (dosya düzenlendi ya da
 * commit atıldı). Salt soru-cevap oturumları atlanır, yoksa gerçek olaylar
 * gürültünün altında kalır. `DEVLOG_SESSION_LOG=all` hepsini yazar.
 *
 * Transcript okuma ve kayıt üretme mantığı `../sessions.ts` içinde — geriye
 * dönük aktarım (`devlog backfill`) aynı yolu kullanır.
 */
runHook(async () => {
  if (process.env['DEVLOG_HOOKS'] === 'off') return
  const mode = process.env['DEVLOG_SESSION_LOG'] ?? 'changed'
  if (mode === 'off') return

  const payload = await readHookPayload()
  const transcriptPath = payload.transcript_path
  const sessionId = payload.session_id
  if (!transcriptPath || !sessionId) return
  void listTranscripts

  const summary = await readTranscript(transcriptPath).catch(() => null)
  if (!summary) return

  if (mode === 'changed' && !sessionChanged(summary)) {
    note('oturum bir şey değiştirmedi, kayıt açılmadı')
    return
  }
  if (await alreadyLogged(sessionId)) {
    note('oturum zaten kayıtlı')
    return
  }

  const draft = sessionDraft({ ...summary, sessionId }, payload.cwd ?? process.cwd())
  const config = await loadConfig()
  const entry = await createEntry(config.vaultRoot, draft)
  note(`oturum kaydedildi → ${entry.id}`)
})
