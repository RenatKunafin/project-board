import { Component, Fragment, type ReactNode } from 'react';

interface WidgetErrorBoundaryProps {
  readonly children: ReactNode;
}

interface WidgetErrorBoundaryState {
  readonly error: Error | null;
  /** Увеличивается при «Повторить»: перемонтирует содержимое (design D3). */
  readonly nonce: number;
}

/**
 * Локальная граница ошибки содержимого окна (design D3): падение отрисовки
 * одного виджета изолируется в его рамке, остальные окна не затронуты.
 */
export class WidgetErrorBoundary extends Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = { error: null, nonce: 0 };

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<WidgetErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown): void {
    // Диагностика в консоль: краши виджетов видны сразу (прецедент MCP).
    console.error('widget render failed', error);
  }

  private retry = (): void => {
    this.setState((previous) => ({
      error: null,
      nonce: previous.nonce + 1,
    }));
  };

  render(): ReactNode {
    const { error, nonce } = this.state;
    if (error) {
      return (
        <div className="widget-error" role="status">
          <p className="widget-error__title">
            Не удалось отобразить содержимое
          </p>
          <p className="widget-error__message">{error.message}</p>
          <button type="button" className="widget-error__retry" onClick={this.retry}>
            Повторить
          </button>
        </div>
      );
    }
    // nonce в key: «Повторить» перемонтирует содержимое заново.
    return <Fragment key={nonce}>{this.props.children}</Fragment>;
  }
}
