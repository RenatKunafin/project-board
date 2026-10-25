/**
 * Локаль SVAR с началом недели в понедельник (PBT-076, design D2.3).
 *
 * Дефолт SVAR — воскресенье (date-fns weekStartsOn 0): недельные колонки
 * шкалы идут Вс–Сб и разбивают выходные пн–пт календаря плана на две
 * колонки. Gantt читает weekStart из локали i18n-контекста
 * (`useContext(context.i18n)` в react-gantt 2.8, `getRaw().calendar.weekStart`),
 * проп `_weekStart` наружу не пробрасывается — единственный путь:
 * Provider того же контекста со своей локалью. Кастомные значения
 * побеждают дефолты Gantt (`ILocale.extend(defaults, optional=true)`
 * в lib-dom — семантика проверена).
 *
 * Изоляция (ADR-3): `context`/`locale` есть в runtime-экспортах
 * `@svar-ui/react-core`, но отсутствуют в его публичных типах —
 * минимальный локальный контракт с cast, по образцу адаптеров
 * (RndProps в CascadeLayout). При недоступности контекста в будущей
 * версии возвращаем null — виджет рендерит Gantt без Provider
 * (деградация до дефолта библиотеки, не краш).
 */

import { createContext } from 'react';
import type { Context } from 'react';
import * as svarReactCore from '@svar-ui/react-core';

/** Минимальный контракт локали SVAR (ILocale из lib-dom). */
export interface SvarLocale {
  getGroup(group: string): (key: string) => string;
  getRaw(): Record<string, unknown>;
  extend(values: Record<string, unknown>, optional: boolean): SvarLocale;
}

/** Runtime-экспорты react-core, отсутствующие в типах пакета. */
interface SvarReactCoreRuntime {
  locale(terms: Record<string, unknown>): SvarLocale;
  context: { i18n?: Context<SvarLocale | null> };
}

const runtime = svarReactCore as unknown as SvarReactCoreRuntime;

/**
 * Контекст i18n SVAR для Provider-обёртки; фолбэк — собственный контекст
 * с null-дефолтом (Gantt без внешнего провайдера ведёт себя как раньше).
 */
export const svarI18nContext: Context<SvarLocale | null> =
  runtime.context?.i18n ?? createContext<SvarLocale | null>(null);

/** Локаль: неделя с понедельника. */
export function createMondayFirstLocale(): SvarLocale | null {
  if (typeof runtime.locale !== 'function') {
    return null;
  }
  return runtime.locale({ calendar: { weekStart: 1 } });
}
