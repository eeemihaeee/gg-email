import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Скачивает GreenMail standalone (Java) для интеграционных тестов IMAP/SMTP.
 * Запускается из tests/integration перед стартом сервера.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = '2.1.0'
const target = join(root, '.cache', `greenmail-standalone-${version}.jar`)

if (existsSync(target) && statSync(target).size > 1_000_000) {
  console.log(`greenmail: ${target}`)
  process.exit(0)
}

mkdirSync(dirname(target), { recursive: true })

const urls = [
  `https://repo.maven.apache.org/maven2/com/icegreen/greenmail-standalone/${version}/greenmail-standalone-${version}.jar`,
  `https://repo1.maven.org/maven2/com/icegreen/greenmail-standalone/${version}/greenmail-standalone-${version}.jar`
]

for (const url of urls) {
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      console.error(`greenmail: HTTP ${response.status} ${url}`)
      continue
    }
    const file = createWriteStream(target)
    for await (const chunk of response.body) file.write(chunk)
    await new Promise((resolve) => file.end(resolve))
    console.log(`greenmail: скачан ${target}`)
    process.exit(0)
  } catch (error) {
    console.error(`greenmail: ${error.message}`)
  }
}

console.error('greenmail: не удалось скачать jar')
process.exit(1)
