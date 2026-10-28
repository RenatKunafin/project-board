import { describe, expect, it } from 'vitest';
import { requestReleaseNotes } from './pwa-update';

describe('заметки ожидающего Service Worker', () => {
  it('получает данные кандидата через канал, не запрашивая активацию', async () => {
    const candidate = { releases: [{ version: 'v9.0.0', date: '2026-10-28', summary: 'Кандидат', changes: ['Новая функция'] }] };
    const requests: unknown[] = [];
    const worker = {
      postMessage(message: unknown, ports: MessagePort[]) {
        requests.push(message);
        ports[0].postMessage({ ok: true, releaseNotes: candidate });
      },
    } as unknown as ServiceWorker;
    await expect(requestReleaseNotes(worker)).resolves.toEqual(candidate);
    expect(requests).toEqual([{ type: 'PB_RELEASE_NOTES' }]);
  });

  it('отклоняет пустой ответ без исключения в обработчике сообщения', async () => {
    const worker = {
      postMessage(_message: unknown, ports: MessagePort[]) {
        ports[0].postMessage(null);
      },
    } as unknown as ServiceWorker;
    await expect(requestReleaseNotes(worker)).rejects.toThrow('Заметки новой версии недоступны.');
  });

  it('сообщает об исчезнувшем кандидате', async () => {
    const worker = {
      postMessage() { throw new Error('worker gone'); },
    } as unknown as ServiceWorker;
    await expect(requestReleaseNotes(worker)).rejects.toThrow('Новая версия больше не доступна.');
  });
});
