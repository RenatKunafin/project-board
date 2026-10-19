import { useEffect, useRef, useState } from 'react';
import type { PlantUmlExportNote } from './plantuml-export';
import './plantuml-export-dialog.css';

interface PlantUmlExportDialogProps {
  readonly text: string;
  readonly report: readonly PlantUmlExportNote[];
  readonly fileName: string;
  readonly onDownload: () => void;
  readonly onClose: () => void;
}

/**
 * Предпросмотр экспорта PlantUML (PBT-056): текст диаграммы (readonly,
 * выделяется вручную — fallback копирования), ограничения генератора
 * и инструкция публикации. Скачивание — родитель (Blob, офлайн).
 */
export default function PlantUmlExportDialog({
  text,
  report,
  fileName,
  onDownload,
  onClose,
}: PlantUmlExportDialogProps) {
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Пользователь может начать с выделения текста — фокус не перебиваем.
    return undefined;
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard недоступен: текст в блоке выделяем вручную.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textRef.current ?? document.body);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  return (
    <div
      className="plantuml-export__overlay"
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <section
        className="plantuml-export"
        role="dialog"
        aria-modal="true"
        aria-label="Экспорт PlantUML"
      >
        <header className="plantuml-export__head">
          <h3 className="plantuml-export__title">Экспорт PlantUML</h3>
          <button
            type="button"
            className="plantuml-export__close"
            aria-label="Закрыть экспорт"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="plantuml-export__body">
          <div className="plantuml-export__section">
            <h4 className="plantuml-export__section-title">Текст диаграммы</h4>
            <div
              ref={textRef}
              className="plantuml-export__text"
              data-plantuml-text
              role="textbox"
              aria-readonly="true"
              tabIndex={0}
            >
              {text}
            </div>
          </div>
          <div className="plantuml-export__section">
            <h4 className="plantuml-export__section-title">
              Ограничения ({report.length})
            </h4>
            <div className="plantuml-export__scroll" data-plantuml-report>
              {report.length === 0 ? (
                <p className="plantuml-export__hint">
                  Все данные плана перенесены в диаграмму без потерь.
                </p>
              ) : (
                <ul className="plantuml-export__list">
                  {report.map((note, index) => (
                    <li key={`note-${index}`}>{note.message}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="plantuml-export__hint">
            Текст самодостаточен для любого инструмента PlantUML. Для
            Confluence вставьте его в PlantUML-макрос вашей инсталляции —
            поддержку и настройки определяет конкретный плагин.
          </p>
          <p className="plantuml-export__file" data-plantuml-file>
            Файл: {fileName}
          </p>
        </div>
        <footer className="plantuml-export__foot">
          <button
            type="button"
            className="plantuml-export__button"
            data-plantuml-copy
            onClick={() => {
              void copy();
            }}
          >
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
          <button
            type="button"
            className="plantuml-export__button plantuml-export__button--primary"
            data-plantuml-download
            onClick={onDownload}
          >
            Скачать .puml
          </button>
          <button
            type="button"
            className="plantuml-export__button"
            onClick={onClose}
          >
            Закрыть
          </button>
        </footer>
      </section>
    </div>
  );
}
