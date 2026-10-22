/**
 * Простая очередь задач: гарантирует, что в рамках одного почтового
 * соединения команды IMAP не пересекаются (один SELECT на соединение).
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task)
    // Хвост не должен «залипать» на ошибке предыдущей задачи.
    this.tail = next.catch(() => undefined)
    return next
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Экспоненциальная задержка с потолком. */
export function backoff(attempt: number, baseMs = 2000, maxMs = 5 * 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 8))
}
