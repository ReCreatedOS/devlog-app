import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * macOS paketini ad-hoc imzalar.
 *
 * `mac.identity: null` imzalamayı tamamen atlıyor; electron-builder Info.plist'i
 * yeniden yazdığı için Electron ikilisinden devralınan linker imzası geçersiz
 * kalıyor (`codesign --verify` → "code has no resources but signature indicates
 * they must be present"). Apple Silicon'da geçersiz imzalı paket Gatekeeper
 * değerlendirmesinde takılır ve başka makinede açılmaz.
 *
 * Ad-hoc imza (`--sign -`) Apple Developer üyeliği gerektirmez ve paketi
 * tutarlı hâle getirir. Notarization YOK — indirilen kopyada yine
 * sağ tık → Aç gerekir (bkz. README).
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
  console.log(`  • ad-hoc imzalandı  ${appPath}`)
}
