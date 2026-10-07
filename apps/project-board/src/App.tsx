import { DASHBOARD_PACKAGE } from '@project-board/dashboard';
import { GANTT_PACKAGE } from '@project-board/gantt';
import { CHECKLIST_PACKAGE } from '@project-board/checklist';
import { SDK_PACKAGE } from '@project-board/widget-sdk';

const registeredPackages = [
  DASHBOARD_PACKAGE,
  GANTT_PACKAGE,
  CHECKLIST_PACKAGE,
  SDK_PACKAGE,
] as const;

export default function App() {
  return (
    <main className="shell">
      <h1 className="shell__title">Project Board</h1>
      <p className="shell__hint">
        Рабочее пространство пусто: типы виджетов ещё не подключены.
      </p>
      <p className="shell__meta">
        Каркас собран; подключено пакетов: {registeredPackages.length}
      </p>
    </main>
  );
}
