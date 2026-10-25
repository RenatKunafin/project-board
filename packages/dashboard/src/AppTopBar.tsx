import type { ReactNode } from 'react';
import { LayoutDashboard } from 'lucide-react';

export interface AppTopBarProps {
  readonly title: string;
  readonly children?: ReactNode;
}

/**
 * Топ-бар каркаса (PBT-072 D1): иконка-лого, название приложения и
 * статусная зона справа (индикатор состояния сохранения документов).
 */
export function AppTopBar({ title, children }: AppTopBarProps) {
  return (
    <header className="app-topbar">
      <span className="app-topbar__logo" aria-hidden="true">
        <LayoutDashboard />
      </span>
      <h1 className="app-topbar__title">{title}</h1>
      <div className="app-topbar__right">{children}</div>
    </header>
  );
}
