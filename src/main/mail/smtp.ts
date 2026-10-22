import { createTransport, type Transporter } from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type { Account, DraftPayload, SendResult, ServerEndpoint } from '@shared/types'
import { secrets } from '../secrets'
import { createLogger } from '../logger'
import { formatAddress } from '@shared/providers'

const log = createLogger('smtp')

function transportOptions(endpoint: ServerEndpoint, user: string, pass: string) {
  return {
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.security === 'tls',
    requireTLS: endpoint.security === 'starttls',
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    tls: {
      servername: endpoint.host,
      minVersion: 'TLSv1.2' as const,
      rejectUnauthorized: true
    }
  }
}

export async function testSmtpConnection(
  endpoint: ServerEndpoint,
  user: string,
  pass: string
): Promise<{ ok: boolean; error?: string }> {
  const transport = createTransport(transportOptions(endpoint, user, pass))
  try {
    await transport.verify()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    transport.close()
  }
}

export interface PreparedMessage {
  raw: Buffer
  envelope: { from: string; to: string[] }
  messageId: string
}

export async function buildRawMessage(
  account: Account,
  draft: DraftPayload
): Promise<PreparedMessage> {
  const composer = new MailComposer({
    from: { name: account.displayName, address: account.email },
    to: draft.to.map(formatAddress).join(', '),
    cc: draft.cc.length > 0 ? draft.cc.map(formatAddress).join(', ') : undefined,
    bcc: draft.bcc.length > 0 ? draft.bcc.map(formatAddress).join(', ') : undefined,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    attachments: draft.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.contentBase64, 'base64'),
      contentType: attachment.contentType
    })),
    textEncoding: 'base64'
  })

  const raw = await composer.compile().build()
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc].map((address) => address.email)
  return {
    raw,
    envelope: { from: account.email, to: recipients },
    messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@kurier>`
  }
}

export async function sendPrepared(
  account: Account,
  prepared: PreparedMessage
): Promise<SendResult> {
  const password = secrets.get(account.id)
  if (!password) return { ok: false, error: 'Нет сохранённого пароля' }

  let transport: Transporter | null = null
  try {
    transport = createTransport(
      transportOptions(account.smtp, account.username, password)
    )
    const info = await transport.sendMail({
      envelope: prepared.envelope,
      raw: prepared.raw
    })
    log.info('Письмо отправлено', { messageId: info.messageId, to: prepared.envelope.to.length })
    return { ok: true, messageId: info.messageId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Ошибка отправки', message)
    return { ok: false, error: message }
  } finally {
    transport?.close()
  }
}
