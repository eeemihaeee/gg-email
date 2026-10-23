// Создаёт репозиторий на GitHub (или сообщает, что он уже есть).
// Токен передаётся через переменную окружения GH_TOKEN и нигде не печатается.
const token = process.env.GH_TOKEN
if (!token) {
  console.error('Не задан GH_TOKEN')
  process.exit(2)
}

const api = 'https://api.github.com'
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'gg-email-release'
}

const name = process.argv[2] ?? 'gg-email'
const isPrivate = process.argv[3] === 'private'

const me = await fetch(`${api}/user`, { headers })
if (!me.ok) {
  console.error('Не удалось авторизоваться:', me.status)
  process.exit(1)
}
const user = await me.json()
console.log('Пользователь:', user.login)

const existing = await fetch(`${api}/repos/${user.login}/${name}`, { headers })
if (existing.ok) {
  const repo = await existing.json()
  console.log('Репозиторий уже существует:', repo.html_url, 'private=' + repo.private)
  process.exit(0)
}

const created = await fetch(`${api}/user/repos`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name,
    description: 'GG Email — почтовый клиент для Windows и браузера (mailcow, Gmail, Яндекс, IMAP/SMTP)',
    private: isPrivate,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    auto_init: false
  })
})
if (!created.ok) {
  console.error('Не удалось создать репозиторий:', created.status, await created.text())
  process.exit(1)
}
const repo = await created.json()
console.log('Создан репозиторий:', repo.html_url)
console.log('Clone URL:', repo.clone_url)
