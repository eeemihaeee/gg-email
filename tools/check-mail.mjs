// Диагностика почтового сервера: проверяет IMAP-вход и печатает ответ сервера.
// Запуск:
//   node tools/check-mail.mjs pm@itxr.ru "пароль" [mail.itxr.ru]
// Пароль не сохраняется и никуда не отправляется.
import { ImapFlow } from 'imapflow'

const [email, password, hostArg] = process.argv.slice(2)
if (!email || !password) {
  console.error('Использование: node tools/check-mail.mjs <email> <пароль> [host]')
  process.exit(2)
}
const host = hostArg || `mail.${email.split('@')[1] || ''}`

const client = new ImapFlow({
  host,
  port: 993,
  secure: true,
  auth: { user: email, pass: password },
  logger: false,
  tls: { servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true }
})

try {
  await client.connect()
  const folders = await client.list()
  console.log(`OK: вход выполнен, сервер ${host}, папок: ${folders.length}`)
  console.log('Папки:', folders.map((folder) => folder.path).join(', '))
  await client.logout()
} catch (error) {
  console.log('FAIL:', error.message)
  if (error.responseText) console.log('Ответ сервера:', error.responseText)
  if (error.serverResponseCode) console.log('Код:', error.serverResponseCode)
  if (error.authenticationFailed) console.log('Сервер сообщил об ошибке аутентификации (неверный логин/пароль или запрещён IMAP).')
  process.exit(1)
}
