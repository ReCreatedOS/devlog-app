/**
 * Türkçe diakritik katlama.
 *
 * Neden: hem commit mesajlarında hem notlarda diakritikler tutarsız
 * ("cikarildi" ↔ "çıkarıldı", "sokumu" ↔ "söküm"). Arama her iki yazımı da
 * bulmak zorunda.
 *
 * Kritik nokta: `'İ'.toLowerCase()` JS'te `i` + birleşik nokta (U+0307) üretir
 * ve `'ı'.toLowerCase()` `ı` olarak kalır. Yani yalnız `toLowerCase()` yetmez —
 * I / İ / ı / i dördü de aynı token'a düşmeli. Bu yüzden önce açık eşleme,
 * sonra NFD + birleşik işaret temizliği yapıyoruz.
 */

const EXPLICIT: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  I: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
  â: 'a',
  Â: 'a',
  î: 'i',
  Î: 'i',
  û: 'u',
  Û: 'u',
}

/** Aramada kullanılan kanonik biçim: diakritiksiz, küçük harf. */
export function fold(input: string): string {
  let mapped = ''
  for (const ch of input) mapped += EXPLICIT[ch] ?? ch
  return mapped
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

/** Dosya adı / id için güvenli slug. Türkçe karakterler katlanır. */
export function slugify(input: string, maxLength = 60): string {
  const slug = fold(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= maxLength) return slug || 'kayit'
  // Kelime ortasında kesme — son tam kelimeye geri sar.
  const cut = slug.slice(0, maxLength)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > maxLength * 0.5 ? cut.slice(0, lastDash) : cut) || 'kayit'
}
