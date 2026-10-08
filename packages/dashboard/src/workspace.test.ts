import { describe, expect, it } from 'vitest';
import {
  addTab,
  createWorkspaceState,
  moveTab,
  removeTab,
  renameTab,
  setActive,
  WorkspaceError,
} from './workspace.js';

describe('workspace — создание и переключение', () => {
  it('создаёт рабочее пространство с одной активной вкладкой', () => {
    const state = createWorkspaceState('Чек-листы');
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ title: 'Чек-листы' });
    expect(state.activeId).toBe(state.tabs[0].id);
  });

  it('новая вкладка становится активной, порядок сохраняется', () => {
    let state = createWorkspaceState('Чек-листы');
    state = addTab(state, 'План ОКАД');
    expect(state.tabs.map((tab) => tab.title)).toEqual([
      'Чек-листы',
      'План ОКАД',
    ]);
    expect(state.activeId).toBe(state.tabs[1].id);
  });

  it('переключение активной вкладки', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B');
    state = setActive(state, state.tabs[0].id);
    expect(state.activeId).toBe(state.tabs[0].id);
  });

  it('неизвестный id отклоняется', () => {
    const state = createWorkspaceState('A');
    expect(() => setActive(state, 'missing')).toThrowError(WorkspaceError);
  });
});

describe('workspace — переименование', () => {
  it('переименовывает вкладку', () => {
    let state = createWorkspaceState('Новая вкладка');
    state = renameTab(state, state.tabs[0].id, 'План ОКАД');
    expect(state.tabs[0].title).toBe('План ОКАД');
  });

  it('пустое название не применяется', () => {
    const state = createWorkspaceState('План ОКАД');
    expect(() => renameTab(state, state.tabs[0].id, '   ')).toThrowError(
      WorkspaceError,
    );
    expect(state.tabs[0].title).toBe('План ОКАД');
  });
});

describe('workspace — порядок', () => {
  it('перемещает вкладку влево', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B');
    state = moveTab(state, state.tabs[1].id, -1);
    expect(state.tabs.map((tab) => tab.title)).toEqual(['B', 'A']);
  });

  it('перемещает вкладку вправо', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B');
    state = moveTab(state, state.tabs[0].id, 1);
    expect(state.tabs.map((tab) => tab.title)).toEqual(['B', 'A']);
  });

  it('на границе бездействует без ошибки', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B');
    const before = state;
    state = moveTab(state, state.tabs[0].id, -1);
    expect(state.tabs).toEqual(before.tabs);
  });
});

describe('workspace — удаление', () => {
  it('удаляет активную: активной становится соседняя справа', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B'); // активна B
    const aId = state.tabs[0].id;
    const bId = state.tabs[1].id;
    state = setActive(state, bId);
    state = removeTab(state, bId);
    expect(state.tabs.map((tab) => tab.title)).toEqual(['A']);
    expect(state.activeId).toBe(aId);
  });

  it('удаление крайней правой активной делает активной соседнюю слева', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B'); // активна B (крайняя правая)
    state = removeTab(state, state.tabs[1].id);
    expect(state.activeId).toBe(state.tabs[0].id);
  });

  it('последняя вкладка не удаляется', () => {
    const state = createWorkspaceState('A');
    expect(() => removeTab(state, state.tabs[0].id)).toThrowError(
      WorkspaceError,
    );
    expect(state.tabs).toHaveLength(1);
  });

  it('неактивная вкладка удаляется без смены активной', () => {
    let state = createWorkspaceState('A');
    state = addTab(state, 'B'); // активна B
    const aId = state.tabs[0].id;
    state = removeTab(state, aId);
    expect(state.activeId).toBe(state.tabs[0].id);
  });
});
