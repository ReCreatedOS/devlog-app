/**
 * Sır tarama ve maskeleme.
 *
 * Bu dosya otomatik yakalamanın ÖN KOŞULU. Claude Code transcript'leri her şeyi
 * içerir: `.env` dökümleri, service-role JWT'leri, imzalı R2 URL'leri, canlı
 * PoC'ler. Oturum özetini transcript'ten üretirken bunlar filtrelenmezse
 * seyir defteri bir sır deposuna dönüşür.
 *
 * İki ayrı kullanım:
 *  - `redact()`  → otomatik üretilen gövdeyi temizler (yakalama yolunda).
 *  - `scanSecrets()` → vault commit'inden önce blokla (elle yazılan kayıtlar).
 */

export interface SecretPattern {
  id: string
  label: string
  re: RegExp
}

/**
 * Desenler bilinçli olarak DAR: yanlış pozitif, kaydın gövdesini okunamaz hâle
 * getirir ve kullanıcı maskelemeye güvenmeyi bırakır. Yüksek kesinlikli,
 * yapısal olarak tanınabilir sırları hedefliyoruz.
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'jwt',
    label: 'JWT',
    // Üç base64url parçası — Supabase anon/service-role anahtarları bu biçimde.
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: 'private-key',
    label: 'özel anahtar',
    // END satırı yoksa (kesilmiş çıktı, yarım yapıştırma) metnin sonuna kadar
    // maskele — yarım bir anahtar da anahtardır.
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----|$)/g,
  },
  { id: 'aws-key', label: 'AWS anahtar kimliği', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', label: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { id: 'github-pat', label: 'GitHub PAT', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { id: 'anthropic-key', label: 'Anthropic anahtarı', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'openai-key', label: 'OpenAI anahtarı', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { id: 'google-key', label: 'Google API anahtarı', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'supabase-token', label: 'Supabase erişim tokenı', re: /\bsbp_[A-Za-z0-9]{40,}\b/g },
  { id: 'npm-token', label: 'npm token', re: /\bnpm_[A-Za-z0-9]{36,}\b/g },
  {
    id: 'bearer',
    label: 'Bearer token',
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  },
  { id: 'stripe-key', label: 'Stripe canlı anahtar', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'slack-token', label: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  {
    id: 'presigned-url',
    label: 'imzalı URL',
    // R2/S3 presigned PUT — imza süresi dolmadan kopyalanırsa yazma yetkisi verir.
    re: /https?:\/\/[^\s'"]*[?&]X-Amz-Signature=[A-Za-z0-9%]+[^\s'"]*/g,
  },
  {
    id: 'env-assignment',
    label: 'gizli env ataması',
    // `SUPABASE_SERVICE_ROLE_KEY=...`, `WORKER_COOKIE_SECRET=...` gibi.
    // Büyük/küçük harf duyarsız: `db_password=` da aynı sırdır. Anahtar kelimenin
    // önünde en az bir karakter şart — düz yazıdaki "password: …" eşleşmesin.
    re: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|SERVICE_ROLE|API_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*['"]?[^\s'"#]{8,}/gi,
  },
  {
    id: 'json-secret',
    label: 'gizli JSON alanı',
    // `"password": "…"`, `"api_key": "…"` — config dökümlerinde.
    re: /["'][A-Za-z0-9_-]*(?:secret|token|password|passwd|api_?key|private_?key|access_?key)["']\s*:\s*["'][^"'\s]{8,}["']/gi,
  },
  {
    id: 'basic-auth-url',
    label: 'URL içinde parola',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]{4,}@[^\s/]+/gi,
  },
]

export interface RedactResult {
  text: string
  /** Bulunan desenlerin etiketleri (tekil). Boşsa hiçbir şey maskelenmedi. */
  found: string[]
}

/**
 * Sırları `«gizlendi: <etiket>»` ile değiştirir.
 *
 * Maskelenen değer TAMAMEN atılır — ilk/son karakterleri bırakmak bile
 * brute-force alanını daraltır, o yüzden hiçbir parçası saklanmaz.
 */
export function redact(text: string): RedactResult {
  let output = text
  const found = new Set<string>()
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern.re, () => {
      found.add(pattern.label)
      return `«gizlendi: ${pattern.label}»`
    })
  }
  return { text: output, found: [...found] }
}

/** Yalnız tespit — maskelemez. Vault commit guard'ı bunu kullanır. */
export function scanSecrets(text: string): string[] {
  const found = new Set<string>()
  for (const pattern of SECRET_PATTERNS) {
    // `test` + /g lastIndex tuzağına düşmemek için her seferinde sıfırla.
    pattern.re.lastIndex = 0
    if (pattern.re.test(text)) found.add(pattern.label)
    pattern.re.lastIndex = 0
  }
  return [...found]
}
