export class WorkspaceError extends Error {
  readonly code: 'last-tab' | 'empty-title' | 'unknown-tab';

  constructor(code: WorkspaceError['code'], message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

export interface WorkspaceTab {
  readonly id: string;
  readonly title: string;
}

export interface WorkspaceState {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeId: string;
}

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === '') {
    throw new WorkspaceError(
      'empty-title',
      'Название вкладки не может быть пустым.',
    );
  }
  return trimmed;
}

export function createWorkspaceState(title = 'Новая вкладка'): WorkspaceState {
  const tab: WorkspaceTab = {
    id: crypto.randomUUID(),
    title: assertTitle(title),
  };
  return { tabs: [tab], activeId: tab.id };
}

export function addTab(
  state: WorkspaceState,
  title = 'Новая вкладка',
): WorkspaceState {
  const tab: WorkspaceTab = {
    id: crypto.randomUUID(),
    title: assertTitle(title),
  };
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

export function renameTab(
  state: WorkspaceState,
  tabId: string,
  title: string,
): WorkspaceState {
  const trimmed = assertTitle(title);
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    throw new WorkspaceError('unknown-tab', `Вкладка "${tabId}" не найдена.`);
  }
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, title: trimmed } : tab,
    ),
  };
}

/** Перемещает вкладку к соседней (-1 — влево, +1 — вправо); на границе бездействует. */
export function moveTab(
  state: WorkspaceState,
  tabId: string,
  direction: -1 | 1,
): WorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    throw new WorkspaceError('unknown-tab', `Вкладка "${tabId}" не найдена.`);
  }
  const target = index + direction;
  if (target < 0 || target >= state.tabs.length) {
    return state;
  }
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(index, 1);
  tabs.splice(target, 0, moved);
  return { ...state, tabs };
}

export function setActive(
  state: WorkspaceState,
  tabId: string,
): WorkspaceState {
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    throw new WorkspaceError('unknown-tab', `Вкладка "${tabId}" не найдена.`);
  }
  return { ...state, activeId: tabId };
}

export function removeTab(
  state: WorkspaceState,
  tabId: string,
): WorkspaceState {
  if (state.tabs.length === 1) {
    throw new WorkspaceError(
      'last-tab',
      'Последнюю вкладку удалить нельзя.',
    );
  }
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    throw new WorkspaceError('unknown-tab', `Вкладка "${tabId}" не найдена.`);
  }
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  const activeId =
    state.activeId === tabId
      ? tabs[Math.min(index, tabs.length - 1)].id
      : state.activeId;
  return { tabs, activeId };
}
