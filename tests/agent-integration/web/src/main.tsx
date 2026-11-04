import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createDocumentService,
  createIndexedDbDocumentStore,
  type AutosavingDocumentService,
  type DocumentStoreLike,
} from '@project-board/dashboard';
import type { DocumentStore } from '@project-board/dashboard';
import type { ManagedDocument } from '@project-board/widget-sdk';
import {
  createRequest,
  disconnect as disconnectRequest,
  pair,
  pollRequest,
  sendAck,
  type PairedSession,
  type ProbeEnvelopeWire,
  type ProbeRequestInfo,
} from './probe-client.js';
import { ensureProbeDocument, applyResult, validateResult } from './probe-document.js';
import { PROBE_DB_NAME, type ProbeSnapshot } from './fixture.js';
import './probe.css';

/**
 * Тестовый composition root стенда PBT-121 (не SDK-виджет).
 * Полномочия сессии — только в памяти вкладки; отдельная БД; без аналитики и SW.
 */

type Phase =
  | 'no-component'
  | 'connected'
  | 'queued'
  | 'processing'
  | 'applying'
  | 'saved'
  | 'saved-no-ack'
  | 'failed'
  | 'poll-stopped';

interface LogEntry {
  readonly at: string;
  readonly message: string;
}

/** Обёртка устойчивого отказа записи для сценария ошибки persistence (D6, test-only). */
function failingStore(base: DocumentStore): DocumentStoreLike {
  return {
    async save() {
      throw new Error('Тестовый отказ записи (pbt121fault=persistence)');
    },
    async saveAll() {
      throw new Error('Тестовый отказ записи (pbt121fault=persistence)');
    },
    get: (id) => base.get(id),
    listAll: () => base.listAll(),
    delete: (id) => base.delete(id),
  };
}

function App() {
  const [phase, setPhase] = useState<Phase>('no-component');
  const [document, setDocument] = useState<ManagedDocument | null>(null);
  const [snapshot, setSnapshot] = useState<ProbeSnapshot | null>(null);
  const [address, setAddress] = useState('http://127.0.0.1:43821');
  const [code, setCode] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const serviceRef = useRef<AutosavingDocumentService | null>(null);
  const storeRef = useRef<DocumentStore | null>(null);
  const sessionRef = useRef<PairedSession | null>(null);
  const activeRequestRef = useRef<ProbeEnvelopeWire | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((message: string) => {
    setLog((entries) => [...entries.slice(-40), { at: new Date().toISOString(), message }]);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const faultPersistence = params.get('pbt121fault') === 'persistence';
    const store = createIndexedDbDocumentStore(PROBE_DB_NAME);
    storeRef.current = store;
    const service = createDocumentService(faultPersistence ? { store: failingStore(store) } : { store });
    serviceRef.current = service;
    void (async () => {
      await service.restoreAll();
      const init = await ensureProbeDocument(service, store);
      serviceRef.current = service;
      setDocument(init.document);
      setSnapshot(init.document.content as ProbeSnapshot);
      addLog(init.created ? 'Создан начальный документ fixture-a' : `Восстановлен документ (ревизия ${init.restoredRevision})`);
    })().catch((error: unknown) => {
      addLog(`Инициализация не завершена: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => {
      abortRef.current?.abort();
    };
  }, [addLog]);

  const onPair = useCallback(async () => {
    try {
      const session = await pair(address, code);
      sessionRef.current = session;
      setPhase('connected');
      addLog(`Сопряжение выполнено (runId ${session.runId.slice(0, 8)}…)`);
    } catch (error) {
      addLog(`Сопряжение не выполнено: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [address, code, addLog]);

  const onRequest = useCallback(async () => {
    const service = serviceRef.current;
    const store = storeRef.current;
    const session = sessionRef.current;
    const current = document;
    if (!service || !store || !session || !current) return;
    if (activeRequestRef.current) {
      addLog('Запрос уже активен; новый не создаётся');
      return;
    }
    try {
      const { envelope } = await createRequest(address, session.token, current.revision);
      activeRequestRef.current = envelope;
      setPhase('queued');
      addLog(`Запрос ${envelope.requestId.slice(0, 8)}… создан (базовая ревизия ${envelope.baseRevision})`);
      const controller = new AbortController();
      abortRef.current = controller;
      let finalStatus: ProbeRequestInfo | null = null;
      for await (const status of pollRequest(address, session.token, envelope.requestId)) {
        if (controller.signal.aborted) return;
        if (status.phase === 'queued' || status.phase === 'processing') {
          setPhase(status.phase);
          continue;
        }
        finalStatus = status;
        break;
      }
      if (!finalStatus) {
        setPhase('poll-stopped');
        addLog('Ожидание остановлено (лимит 120 с); новый запрос не создаётся автоматически');
        return;
      }
      const final: ProbeRequestInfo = finalStatus;
      if (final.phase === 'failed' || final.failure) {
        setPhase('failed');
        addLog(`Ошибка обмена: ${final.failure?.code ?? 'failed'} — ${final.failure?.message ?? ''}`);
        activeRequestRef.current = null;
        return;
      }
      const validation = validateResult(envelope, final, session);
      if (!validation.ok) {
        setPhase('failed');
        addLog(`Результат не прошёл проверку: ${validation.message}`);
        return;
      }
      setPhase('applying');
      const outcome = await applyResult(service, store, current.id, envelope, validation.snapshot, final.result?.resultId ?? 'unknown');
      if (outcome.kind === 'mismatch' || outcome.kind === 'save-error') {
        setPhase('failed');
        addLog(`Применение не выполнено: ${outcome.message}`);
        return;
      }
      const updated = service.get(current.id);
      if (updated) {
        setDocument(updated);
        setSnapshot(updated.content as ProbeSnapshot);
      }
      if (outcome.kind === 'duplicate') {
        setPhase('saved');
        addLog(`Повторная доставка: результат уже сохранён (ревизия ${outcome.revision})`);
        return;
      }
      try {
        await sendAck(address, session.token, envelope.requestId);
        setPhase('saved');
        addLog(`Результат сохранён (ревизия ${outcome.revision}) и подтверждён`);
      } catch (error) {
        setPhase('saved-no-ack');
        addLog(`Данные сохранены, подтверждение не доставлено: ${error instanceof Error ? error.message : String(error)}`);
      }
      activeRequestRef.current = null;
    } catch (error) {
      setPhase('failed');
      addLog(`Обмен не завершён: ${error instanceof Error ? error.message : String(error)}`);
      activeRequestRef.current = null;
    }
  }, [address, document, addLog]);

  const onDisconnect = useCallback(async () => {
    const session = sessionRef.current;
    abortRef.current?.abort();
    activeRequestRef.current = null;
    if (!session) return;
    try {
      await disconnectRequest(address, session.token);
      addLog('Сессия отключена');
    } catch (error) {
      addLog(`Отключение: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      sessionRef.current = null;
      setPhase('no-component');
    }
  }, [address, addLog]);

  const phaseLabel: Record<Phase, string> = {
    'no-component': 'Компонент не сопряжён',
    connected: 'Подключено. Ожидаем запрос',
    queued: 'В очереди',
    processing: 'Обработка агентом',
    applying: 'Применение данных',
    saved: 'Сохранено',
    'saved-no-ack': 'Данные сохранены, подтверждение не доставлено',
    failed: 'Ошибка',
    'poll-stopped': 'Ожидание остановлено',
  };

  return (
    <main className="probe-root">
      <h1>PBT-121 — синтетическая проба агента</h1>
      <p data-testid="probe-phase" data-phase={phase}>
        {phaseLabel[phase]}
      </p>
      <section className="probe-panel">
        <label>
          Адрес компонента
          <input data-testid="probe-address" value={address} onChange={(event) => setAddress(event.target.value)} />
        </label>
        <label>
          Код сопряжения (probe_session)
          <input data-testid="probe-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="из MCP-инструмента probe_session" />
        </label>
        <div className="probe-actions">
          <button data-testid="probe-pair" onClick={() => void onPair()}>
            Сопрячь
          </button>
          <button data-testid="probe-request" onClick={() => void onRequest()} disabled={!sessionRef.current || phase === 'queued' || phase === 'processing' || phase === 'applying'}>
            Обновить (синтетический запрос)
          </button>
          <button data-testid="probe-disconnect" onClick={() => void onDisconnect()}>
            Отключить
          </button>
        </div>
      </section>
      <section data-testid="probe-document" className="probe-document">
        <h2>Тестовый документ</h2>
        {snapshot && document ? (
          <dl>
            <dt>fixtureId</dt>
            <dd data-testid="probe-fixture">{snapshot.fixtureId}</dd>
            <dt>Спринт</dt>
            <dd data-testid="probe-sprint">{snapshot.sprintName}</dd>
            <dt>Актуальность</dt>
            <dd data-testid="probe-asof">{snapshot.asOf}</dd>
            <dt>Задач</dt>
            <dd data-testid="probe-items">{snapshot.items.length}</dd>
            <dt>Ревизия</dt>
            <dd data-testid="probe-revision">{document.revision}</dd>
            <dt>lastAppliedRequestId</dt>
            <dd data-testid="probe-applied-request">{(snapshot as { lastAppliedRequestId?: string }).lastAppliedRequestId ?? '—'}</dd>
          </dl>
        ) : (
          <p data-testid="probe-document-pending">Документ восстанавливается…</p>
        )}
      </section>
      <section className="probe-log">
        <h2>Журнал</h2>
        <ul data-testid="probe-log">
          {log.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time>{entry.at}</time> {entry.message}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
