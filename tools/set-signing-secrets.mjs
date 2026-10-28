import { readFileSync } from 'node:fs'
import sodium from 'libsodium-wrappers'

/**
 * Загружает CSC_LINK (base64 PFX) и CSC_KEY_PASSWORD в GitHub Actions Secrets.
 * Запуск:
 *   GH_TOKEN=... node tools/set-signing-secrets.mjs build/certs/gg-email-codesign.pfx "пароль"
 */
const [pfxPath, password, rootPath] = process.argv.slice(2)
const token = process.env.GH_TOKEN
const repo = process.env.GITHUB_REPOSITORY ?? 'eeemihaeee/gg-email'

if (!pfxPath || !password) {
  console.error('Использование: node tools/set-signing-secrets.mjs <pfx> <пароль>')
  process.exit(2)
}
if (!token) {
  console.error('Нужен GH_TOKEN с правами repo (Actions secrets: write)')
  process.exit(2)
}

await sodium.ready

const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'gg-email',
  Accept: 'application/vnd.github+json'
}

const keyResponse = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
  headers
})
if (!keyResponse.ok) {
  console.error('Не удалось получить public key:', keyResponse.status, await keyResponse.text())
  process.exit(1)
}
const { key, key_id: keyId } = await keyResponse.json()

function encrypt(value) {
  const message = sodium.from_string(value)
  const publicKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
  const sealed = sodium.crypto_box_seal(message, publicKey)
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL)
}

async function putSecret(name, value) {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value: encrypt(value), key_id: keyId })
  })
  if (!response.ok) {
    console.error(`Секрет ${name}:`, response.status, await response.text())
    process.exit(1)
  }
  console.log(`Секрет ${name} обновлён`)
}

const pfxBase64 = readFileSync(pfxPath).toString('base64')
await putSecret('CSC_LINK', pfxBase64)
await putSecret('CSC_KEY_PASSWORD', password)
if (rootPath) {
  const rootBase64 = readFileSync(rootPath).toString('base64')
  await putSecret('ROOT_CERT_BASE64', rootBase64)
}
console.log('Готово: PFX и пароль загружены в секреты репозитория', repo)
