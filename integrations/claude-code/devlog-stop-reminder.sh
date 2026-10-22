#!/usr/bin/env bash
# Stop hook — oturumda kalıcı değeri olan iş yapıldıysa devlog kaydı yazmayı hatırlatır.
# Oturum başına EN FAZLA BİR KEZ tetiklenir; stop_hook_active ile döngü kırılır.
set -u
input=$(cat)

# 1) Zaten bir stop-hook devamındaysak asla tekrar bloklama (sonsuz döngü koruması)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

# 2) Önemsiz/kısa oturumlarda tetikleme — transcript yeterince büyümemişse çık
tp=$(printf '%s' "$input" | jq -r '.transcript_path // ""')
lines=0
[ -n "$tp" ] && [ -f "$tp" ] && lines=$(wc -l < "$tp" | tr -d ' ')
[ "${lines:-0}" -lt 40 ] && exit 0

# 3) Oturum başına tek sefer
sid=$(printf '%s' "$input" | jq -r '.session_id // "unknown"')
d="${TMPDIR:-/tmp}/claude-devlog-stop"; mkdir -p "$d"
[ -f "$d/$sid" ] && exit 0
touch "$d/$sid"

jq -n '{
  decision: "block",
  reason: "DEVLOG KONTROLÜ (oturum başına bir kez, otomatik).\n\nBu oturumda KALICI değeri olan bir şey oldu mu? Kriterler:\n- güvenlik bulgusu / zafiyet (canlı doğrulanmış ya da statik)\n- incident veya kök-neden teşhisi\n- verilmiş bir KARAR + gerekçesi (\"şunu yapmıyoruz çünkü...\" dahil)\n- deploy / migration / canlı doğrulama\n- tekrar işine yarayacak öğrenilen ders veya yanlış alarm\n\nVARSA: mcp__devlog__devlog_create ile yaz (type/severity/status/tags/occurred_at dolu). Var olan bir olay ilerlediyse yeni kayıt açma — mcp__devlog__devlog_search ile bul, mcp__devlog__devlog_append ile altına ekle. Sonra kullanıcıya hangi kaydı yazdığını TEK SATIR söyle.\n\nYOKSA: hiçbir şey yazma. Rutin dosya düzenlemesi, keşif/okuma, soru-cevap devlog kaydı DEĞİLDİR. Bu durumda kullanıcıya bu kontrolden hiç bahsetme, sadece işine devam et / dur.\n\nNot: commit kayıtları ve ham oturum özeti zaten devlog CLI hooklarıyla otomatik yazılıyor — sen yalnızca KÜRATÖRLÜ kaydı (yargı gerektiren) yaz, onları tekrarlama."
}'
