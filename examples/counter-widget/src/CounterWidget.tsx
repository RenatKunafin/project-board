import { useEffect, useState } from 'react';
import type { ManagedDocument, WidgetProps, WidgetSize } from '@project-board/widget-sdk';
import { parseCounter } from './model';
import './counter.css';

export default function CounterWidget({
  documentId, documentService, widgetInstanceId, settings, updateSettings, onResize, visible,
}: WidgetProps) {
  const [document, setDocument] = useState<ManagedDocument | undefined>();
  // settings — стартовый снимок; обновления своего окна храним и в state.
  const [compact, setCompact] = useState(settings.compact === true);
  const [size, setSize] = useState<WidgetSize>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!documentId || !documentService) return;
    setDocument(documentService.get(documentId));
    // Не отключаем подписку при hidden: оба вида остаются актуальными.
    return documentService.subscribe(documentId, setDocument);
  }, [documentId, documentService]);
  useEffect(() => onResize?.(setSize), [onResize]);

  if (!documentId || !documentService) return <p role="status">Документ не привязан.</p>;
  if (!document) return <p role="status">Загрузка счётчика…</p>;
  if (document.schemaVersion > 2) return <p role="alert">Новая версия документа: обновите приложение.</p>;
  let count: number;
  try { count = parseCounter(document.content).count; }
  catch (failure) { return <p role="alert">{(failure as Error).message}</p>; }

  const increment = () => {
    try {
      // Читаем свежую редакцию перед записью, не увеличиваем старый снимок.
      const latest = documentService.get(documentId);
      if (!latest) throw new Error('Документ удалён.');
      const next = parseCounter({ count: parseCounter(latest.content).count + 1 });
      documentService.update(documentId, latest.revision, next);
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  };
  return (
    <section className="counter-widget" data-counter-instance={widgetInstanceId} data-document-id={documentId} data-counter-visible={visible}>
      <output aria-label="Значение счётчика">{count}</output>
      <button type="button" onClick={increment}>Увеличить</button>
      <button type="button" aria-pressed={compact} onClick={() => {
        const next = !compact;
        setCompact(next);
        updateSettings?.({ compact: next });
      }}>Компактный вид</button>
      {!compact && <p>Общее число хранится в документе; компактный вид — настройка этого окна.</p>}
      {!compact && size && <small>Размер: {Math.round(size.width)} × {Math.round(size.height)}</small>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
