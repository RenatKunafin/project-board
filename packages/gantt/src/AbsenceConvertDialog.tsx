import { useEffect, useRef, useState } from 'react';
import type { PlanResource } from './plan-document';
import './absence-convert.css';
import PlanDialog, { type PlanDialogOwner } from './PlanDialog';

export interface AbsenceConvertInput {
  readonly resourceId: string;
  readonly start: string;
  readonly end: string;
}

interface AbsenceConvertDialogProps {
  readonly owner: PlanDialogOwner;
  readonly taskTitle: string;
  readonly taskStart: string;
  readonly taskEnd: string;
  readonly resources: readonly PlanResource[];
  /** Возвращает текст ошибки ядра (диалог остаётся открыт) или undefined при успехе. */
  readonly onApply: (input: AbsenceConvertInput) => string | undefined;
  readonly onClose: () => void;
}

/**
 * Преобразование задачи в период недоступности (PBT-054, D7 ADR
 * PBT-003): ресурс выбирается пользователем — без предвыбора и
 * угадывания по названию. Даты предзаполнены из задачи, редактируемы.
 * Отмена/Esc ничего не меняют.
 */
export default function AbsenceConvertDialog({
  owner,
  taskTitle,
  taskStart,
  taskEnd,
  resources,
  onApply,
  onClose,
}: AbsenceConvertDialogProps) {
  const [resourceId, setResourceId] = useState('');
  const [start, setStart] = useState(taskStart);
  const [end, setEnd] = useState(taskEnd);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  const submit = () => {
    if (resourceId === '') {
      setError('Выберите ресурс.');
      return;
    }
    const message = onApply({ resourceId, start, end });
    if (message !== undefined) {
      setError(message);
    }
  };

  const hasResources = resources.length > 0;

  return (
    <PlanDialog
      owner={owner}
      title="Преобразование в отпуск"
      description="Период недоступности ресурса вместо задачи."
      closeLabel="Закрыть преобразование"
      className="absence-convert"
      onClose={onClose}
    >
      <div className="absence-convert__body plan-dialog__body">
        <p className="absence-convert__note">
          Задача «{taskTitle}» будет удалена вместе с назначениями и
          зависимостями. Будет создан один период недоступности выбранного
          ресурса.
        </p>
        {hasResources ? (
          <>
            <label className="absence-convert__field">
              <span className="absence-convert__label">Ресурс</span>
              <select
                ref={selectRef}
                value={resourceId}
                data-absence-resource
                onChange={(event) => {
                  setResourceId(event.target.value);
                  setError(null);
                }}
              >
                <option value="">Выберите ресурс</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="absence-convert__row">
              <label className="absence-convert__field">
                <span className="absence-convert__label">Начало</span>
                <input
                  type="date"
                  value={start}
                  data-absence-start
                  onChange={(event) => {
                    setStart(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              <label className="absence-convert__field">
                <span className="absence-convert__label">Окончание</span>
                <input
                  type="date"
                  value={end}
                  data-absence-end
                  onChange={(event) => {
                    setEnd(event.target.value);
                    setError(null);
                  }}
                />
              </label>
            </div>
          </>
        ) : (
          <p className="absence-convert__note" data-absence-empty>
            В плане нет ресурсов — создайте их в «Настройках плана», затем
            вернитесь к преобразованию.
          </p>
        )}
        {error !== null && (
          <p className="absence-convert__error" role="alert" data-absence-error>
            {error}
          </p>
        )}
      </div>
      <footer className="absence-convert__foot">
        <button
          type="button"
          className="absence-convert__button"
          data-absence-cancel
          onClick={onClose}
        >
          Отмена
        </button>
        {hasResources && (
          <button
            type="button"
            className="absence-convert__button absence-convert__button--primary"
            data-absence-apply
            onClick={submit}
          >
            Преобразовать
          </button>
        )}
      </footer>
    </PlanDialog>
  );
}
