const COUNTER_ID = 113967203;
const SCRIPT_ID = 'project-board-yandex-metrika';
const SCRIPT_URL = `https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}`;

type MetrikaInit = {
  ssr: boolean;
  webvisor: boolean;
  clickmap: boolean;
  trackLinks: boolean;
  ecommerce: 'dataLayer';
  referrer: string;
  url: string;
  accurateTrackBounce: boolean;
};

type MetrikaFunction = {
  (counterId: number, command: 'init', options: MetrikaInit): void;
  a?: unknown[][];
  l?: number;
};

type MetrikaWindow = Window & {
  ym?: MetrikaFunction;
  __projectBoardYandexMetrika?: { counterId: number };
};

export type YandexMetrikaBootstrapOptions = {
  enabled?: boolean;
  webvisor?: boolean;
  window?: Window;
  document?: Document;
  location?: Pick<Location, 'href'>;
  baseUrl?: string;
};

export const YANDEX_METRIKA_COUNTER_ID = COUNTER_ID;

export function normalizeMetrikaUrl(
  location: Pick<Location, 'href'>,
  baseUrl: string = import.meta.env.BASE_URL,
): string {
  const publicUrl = new URL(baseUrl || '/', location.href);
  return `${publicUrl.origin}${publicUrl.pathname}`;
}

export function initializeYandexMetrika(options: YandexMetrikaBootstrapOptions = {}): boolean {
  const currentWindow = (options.window ?? getBrowserWindow()) as MetrikaWindow | undefined;
  const currentDocument = options.document ?? currentWindow?.document;
  if (!currentWindow || !currentDocument) {
    return false;
  }

  const enabled = options.enabled ?? import.meta.env.VITE_YANDEX_METRIKA_ENABLED === 'true';
  if (!enabled) {
    return false;
  }
  if (currentWindow.navigator.onLine === false) {
    return false;
  }

  if (currentWindow.__projectBoardYandexMetrika?.counterId === COUNTER_ID) {
    return false;
  }
  if (currentDocument.getElementById(SCRIPT_ID)) {
    currentWindow.__projectBoardYandexMetrika = { counterId: COUNTER_ID };
    return false;
  }

  const ym = currentWindow.ym ?? createMetrikaFunction();
  currentWindow.ym = ym;
  ym(COUNTER_ID, 'init', {
    ssr: true,
    webvisor: options.webvisor ?? import.meta.env.VITE_YANDEX_METRIKA_WEBVISOR !== 'false',
    clickmap: true,
    trackLinks: true,
    ecommerce: 'dataLayer',
    referrer: currentDocument.referrer,
    url: normalizeMetrikaUrl(options.location ?? currentWindow.location, options.baseUrl),
    accurateTrackBounce: true,
  });

  currentWindow.__projectBoardYandexMetrika = { counterId: COUNTER_ID };
  const script = currentDocument.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = SCRIPT_URL;
  script.onerror = () => {
    // Блокировщик или отказ сети не должны становиться ошибкой приложения.
  };
  try {
    (currentDocument.head ?? currentDocument.documentElement).appendChild(script);
  } catch {
    // Аналитика не должна мешать запуску приложения, даже если DOM недоступен.
  }
  return true;
}

function createMetrikaFunction(): MetrikaFunction {
  const ym = ((...args: unknown[]) => {
    ym.a = ym.a ?? [];
    ym.a.push(args);
  }) as MetrikaFunction;
  ym.l = Date.now();
  return ym;
}

function getBrowserWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}
