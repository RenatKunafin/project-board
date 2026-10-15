import { useEffect, useRef, useState } from 'react';
import type { PlanContent, PlanGroup } from './plan-document';
import {
  availableParentOptions,
  validateGroupForm,
  type GroupFormIssue,
} from './group-editor';
import './task-editor.css';

export interface GroupEditorSubmit {
  readonly title: string;
  /** Пустая строка — корень плана. */
  readonly parentId: string;
}

interface GroupEditorDialogProps {
  readonly plan: PlanContent;
  readonly mode: 'create' | 'edit';
  readonly group?: PlanGroup;
  /** Возвращает ошибку ядра (например, цикл вложенности) — форма остаётся открытой. */
  readonly onSubmit: (submit: GroupEditorSubmit) => GroupFormIssue | undefined;
  readonly onDelete?: () => void;
  readonly onClose: () => void;
}

/**
 * Форма группы (PBT-040): название + родитель («Корень» или группа).
 * Перенос в собственного потомка не исключается из селекта — его
 * отклоняет ядро, сообщение объясняет цикл вложенности (B3/DoD).
 * Esc — отмена, Enter — подтверждение; фокус в первое поле.
 */
export default function GroupEditorDialog({
  plan,
  mode,
  group,
  onSubmit,
  onDelete,
  onClose,
}: GroupEditorDialogProps) {
  const [title, setTitle] = useState(group?.title ?? '');
  const [parentId, setParentId] = useState(group?.parentId ?? '');
  const [issue, setIssue] = useState<GroupFormIssue | undefined>();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const parentOptions = availableParentOptions(plan, group?.id);

  const submit = () => {
    const input = {
      title,
      ...(parentId === '' ? {} : { parentId }),
    };
    const validation = validateGroupForm(input, plan);
    if (validation !== undefined) {
      setIssue(validation);
      return;
    }
    const coreIssue = onSubmit({ title, parentId });
    if (coreIssue !== undefined) {
      setIssue(coreIssue);
      return;
    }
    setIssue(undefined);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const handleFieldKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="task-editor__overlay"
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <section
        className="task-editor"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? 'Новая группа' : 'Редактирование группы'}
      >
        <header className="task-editor__head">
          <h3 className="task-editor__title">
            {mode === 'create' ? 'Новая группа' : 'Редактирование группы'}
          </h3>
          <button
            type="button"
            className="task-editor__close"
            aria-label="Закрыть форму"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="task-editor__body">
          <label className="task-editor__field">
            <span className="task-editor__label">Название</span>
            <input
              ref={titleRef}
              type="text"
              value={title}
              data-group-field="title"
              onKeyDown={handleFieldKeyDown}
              onChange={(event) => setTitle(event.target.value)}
            />
            {issue?.field === 'title' && (
              <span className="task-editor__error" role="alert">
                {issue.message}
              </span>
            )}
          </label>
          <label className="task-editor__field">
            <span className="task-editor__label">Родительская группа</span>
            <select
              value={parentId}
              data-group-field="parent"
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">Корень</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
            {issue?.field === 'parent' && (
              <span className="task-editor__error" role="alert">
                {issue.message}
              </span>
            )}
          </label>
        </div>
        <footer className="task-editor__foot">
          {mode === 'edit' && onDelete !== undefined && (
            <button
              type="button"
              className="task-editor__button task-editor__button--danger"
              data-group-delete
              onClick={() => {
                if (window.confirm(`Удалить группу «${title}»?`)) {
                  onDelete();
                }
              }}
            >
              Удалить
            </button>
          )}
          <div className="task-editor__foot-spacer" />
          <button
            type="button"
            className="task-editor__button"
            data-group-cancel
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="task-editor__button task-editor__button--primary"
            data-group-save
            onClick={submit}
          >
            Сохранить
          </button>
        </footer>
      </section>
    </div>
  );
}
