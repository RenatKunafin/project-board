import { useEffect, useRef, useState } from 'react';
import {
  ONLINEGANTT_DEFAULT_TITLE,
  type ImportedPlanTask,
  type OnlineGanttPayload,
} from './onlinegantt-parser';
import './onlinegantt-import.css';
import PlanDialog, { type PlanDialogOwner } from './PlanDialog';

interface OnlineGanttImportDialogProps {
  readonly owner: PlanDialogOwner;
  readonly fileName: string;
  readonly payload: OnlineGanttPayload;
  readonly onApply: (title: string) => void;
  readonly onCancel: () => void;
}

/** Предзаполнение названия: имя файла без расширения (design D3). */
export function importTitleFromFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
  return base !== '' ? base : ONLINEGANTT_DEFAULT_TITLE;
}

/**
 * Предпросмотр импорта OnlineGantt .gantt (PBT-053): сводка разбора,
 * предупреждения отчёта, задачи без исполнителя как ручные решения,
 * примечания текстом. Применение — родитель (создание документа),
 * Esc/«Отмена» — без изменений данных.
 */
export default function OnlineGanttImportDialog({
  owner,
  fileName,
  payload,
  onApply,
  onCancel,
}: OnlineGanttImportDialogProps) {
  const [title, setTitle] = useState(() => importTitleFromFile(fileName));
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = title.trim();
    onApply(trimmed === '' ? ONLINEGANTT_DEFAULT_TITLE : trimmed);
  };

  const summary = payload.report.summary;
  const warnings = payload.report.warnings;
  const unassigned = payload.content.tasks.filter(
    (task) => task.assigneeIds === undefined || task.assigneeIds.length === 0,
  );
  const noted = payload.content.tasks.filter(
    (task): task is ImportedPlanTask =>
      (task as ImportedPlanTask).notes !== undefined,
  );

  return (
    <PlanDialog
      owner={owner}
      title="Импорт плана из OnlineGantt"
      description="Файл проверяется до создания; будет создан новый независимый план."
      closeLabel="Закрыть предпросмотр"
      className="onlinegantt-import"
      onClose={onCancel}
    >
      <div className="onlinegantt-import__body plan-dialog__body">
        <p className="onlinegantt-import__file" data-onlinegantt-file>
          Файл: {fileName}
        </p>
        <label className="onlinegantt-import__field">
          <span className="onlinegantt-import__label">
            Название создаваемого плана
          </span>
          <input
            ref={titleRef}
            type="text"
            value={title}
            data-onlinegantt-title
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
        </label>
        <p className="onlinegantt-import__summary" data-onlinegantt-summary>
          Задач {summary.tasks} · Групп {summary.groups} · Ресурсов{' '}
          {summary.resources} · Зависимостей {summary.dependencies} · Без
          исполнителя {summary.unassignedTasks}
        </p>
        <div className="onlinegantt-import__section">
          <h4 className="onlinegantt-import__section-title">
            Предупреждения разбора ({warnings.length})
          </h4>
          <div className="onlinegantt-import__scroll" data-onlinegantt-warnings>
            {warnings.length === 0 ? (
              <p className="onlinegantt-import__hint">
                Предупреждений нет — все данные файла перенесены.
              </p>
            ) : (
              <ul className="onlinegantt-import__list">
                {warnings.map((warning, index) => (
                  <li key={`warning-${index}`}>
                    {warning.code}
                    {warning.path ? ` (${warning.path})` : ''}:{' '}
                    {warning.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="onlinegantt-import__section">
          <h4 className="onlinegantt-import__section-title">
            Требуют ручного решения ({unassigned.length})
          </h4>
          <p className="onlinegantt-import__hint">
            Задачи без исполнителя останутся в плане как есть: назначьте
            исполнителя или преобразуйте в период недоступности (отпуск)
            после импорта. Записи не удаляются.
          </p>
          <div className="onlinegantt-import__scroll" data-onlinegantt-unassigned>
            {unassigned.length === 0 ? (
              <p className="onlinegantt-import__hint">
                Все задачи имеют исполнителей.
              </p>
            ) : (
              <ul className="onlinegantt-import__list">
                {unassigned.map((task) => (
                  <li key={task.id}>{task.title}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="onlinegantt-import__section">
          <h4 className="onlinegantt-import__section-title">
            Примечания ({noted.length})
          </h4>
          <p className="onlinegantt-import__hint">
            Примечания исходного файла переносятся текстом без разметки.
          </p>
          <div className="onlinegantt-import__scroll" data-onlinegantt-notes>
            {noted.length === 0 ? (
              <p className="onlinegantt-import__hint">
                Примечаний в файле нет.
              </p>
            ) : (
              <ul className="onlinegantt-import__list">
                {noted.map((task) => (
                  <li key={`note-${task.id}`}>
                    {task.title} — {task.notes}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <footer className="onlinegantt-import__foot">
        <button
          type="button"
          className="onlinegantt-import__button"
          data-onlinegantt-cancel
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="onlinegantt-import__button onlinegantt-import__button--primary"
          data-onlinegantt-apply
          onClick={submit}
        >
          Импортировать
        </button>
      </footer>
    </PlanDialog>
  );
}
