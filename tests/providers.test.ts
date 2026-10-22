import { describe, expect, it } from 'vitest'
import {
  detectFolderRole,
  guessEndpoints,
  isValidEmail,
  parseAddressList,
  presetForEmail
} from '@shared/providers'

describe('провайдеры и папки', () => {
  it('определяет роли папок по именам, включая русские', () => {
    expect(detectFolderRole('INBOX')).toBe('inbox')
    expect(detectFolderRole('Отправленные')).toBe('sent')
    expect(detectFolderRole('Черновики')).toBe('drafts')
    expect(detectFolderRole('Корзина')).toBe('trash')
    expect(detectFolderRole('Спам')).toBe('junk')
    expect(detectFolderRole('Архив')).toBe('archive')
    expect(detectFolderRole('Projects/1C')).toBe('other')
  })

  it('понимает special-use флаги и Gmail-пути', () => {
    expect(detectFolderRole('[Gmail]/Sent Mail')).toBe('sent')
    expect(detectFolderRole('[Gmail]/Spam')).toBe('junk')
    expect(detectFolderRole('Whatever', '\\Junk')).toBe('junk')
    expect(detectFolderRole('Whatever', undefined, ['\\Drafts'])).toBe('drafts')
  })

  it('находит пресеты известных провайдеров', () => {
    expect(presetForEmail('user@gmail.com')?.id).toBe('gmail')
    expect(presetForEmail('user@yandex.ru')?.id).toBe('yandex')
    expect(presetForEmail('user@mail.ru')?.id).toBe('mailru')
    expect(presetForEmail('user@company.ru')).toBeUndefined()
  })

  it('угадывает серверы для неизвестного домена', () => {
    const endpoints = guessEndpoints('ivan@firma.ru')
    expect(endpoints?.imap).toEqual({ host: 'imap.firma.ru', port: 993, security: 'tls' })
    expect(endpoints?.smtp.host).toBe('smtp.firma.ru')
  })

  it('валидирует адреса и разбирает списки', () => {
    expect(isValidEmail('a@b.ru')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(parseAddressList('Иван <ivan@example.ru>, petr@example.ru')).toEqual([
      { name: 'Иван', email: 'ivan@example.ru' },
      { name: '', email: 'petr@example.ru' }
    ])
  })
})
