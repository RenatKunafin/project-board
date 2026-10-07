import type { ComponentType } from 'react';

export type WidgetTypeSettings = Record<string, unknown>;

export interface WidgetProps {
  readonly widgetInstanceId: string;
  readonly settings: WidgetTypeSettings;
}

export interface WidgetSizeConstraints {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

export interface WidgetTypeDefinition {
  readonly id: string;
  readonly title: string;
  readonly component: ComponentType<WidgetProps>;
  readonly startSettings: WidgetTypeSettings;
  readonly sizeConstraints: WidgetSizeConstraints;
}

export class WidgetRegistryError extends Error {
  readonly conflictingId?: string;

  constructor(message: string, conflictingId?: string) {
    super(message);
    this.name = 'WidgetRegistryError';
    this.conflictingId = conflictingId;
  }
}

export const SDK_PACKAGE = '@project-board/widget-sdk' as const;

export function defineWidgetType(definition: WidgetTypeDefinition): WidgetTypeDefinition {
  return definition;
}
