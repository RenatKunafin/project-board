// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { initializeYandexMetrika, normalizeMetrikaUrl, YANDEX_METRIKA_COUNTER_ID } from './yandex-metrika';

type TestWindow = Window & {
  ym?: { a?: unknown[][] };
  __projectBoardYandexMetrika?: { counterId: number };
  dataLayer?: unknown[];
};

const testWindow = () => window as TestWindow;

describe('загрузчик Яндекс Метрики', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    document.getElementById('project-board-yandex-metrika')?.remove();
    delete testWindow().ym;
    delete testWindow().__projectBoardYandexMetrika;
    delete testWindow().dataLayer;
  });

  it('не загружает счётчик без release-флага', () => {
    expect(initializeYandexMetrika({ enabled: false })).toBe(false);
    expect(document.getElementById('project-board-yandex-metrika')).toBeNull();
    expect(testWindow().ym).toBeUndefined();
  });

  it('создаёт один скрипт и ставит согласованную конфигурацию', () => {
    expect(normalizeMetrikaUrl({ href: 'https://board.example/project-board/?document=private#view' }, '/project-board/'))
      .toBe('https://board.example/project-board/');
    expect(initializeYandexMetrika({
      enabled: true,
      webvisor: true,
      location: { href: 'https://board.example/project-board/?document=private#view' },
      baseUrl: '/project-board/',
    })).toBe(true);

    const script = document.getElementById('project-board-yandex-metrika') as HTMLScriptElement;
    expect(script.src).toBe(`https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_COUNTER_ID}`);
    expect(testWindow().ym?.a).toHaveLength(1);
    expect(testWindow().ym?.a?.[0]).toEqual([
      YANDEX_METRIKA_COUNTER_ID,
      'init',
      expect.objectContaining({
        webvisor: true,
        clickmap: true,
        trackLinks: true,
        ecommerce: 'dataLayer',
        url: 'https://board.example/project-board/',
      }),
    ]);
    expect(testWindow().dataLayer).toBeUndefined();
  });

  it('идемпотентен при повторной инициализации', () => {
    expect(initializeYandexMetrika({ enabled: true })).toBe(true);
    expect(initializeYandexMetrika({ enabled: true })).toBe(false);
    expect(document.querySelectorAll('#project-board-yandex-metrika')).toHaveLength(1);
    expect(testWindow().ym?.a).toHaveLength(1);
  });

  it('переносит отказ сети в no-op', () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
    window.addEventListener('error', onError);
    try {
      expect(initializeYandexMetrika({ enabled: true })).toBe(true);
      const script = document.getElementById('project-board-yandex-metrika')!;
      script.dispatchEvent(new Event('error'));
      expect(errors).toEqual([]);
      expect(document.body).toBeTruthy();
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  it('не создаёт внешний запрос при уже активном offline-режиме', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    expect(initializeYandexMetrika({ enabled: true })).toBe(false);
    expect(document.getElementById('project-board-yandex-metrika')).toBeNull();
  });
});
