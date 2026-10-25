// Эталонный файл формата (PBT-050, design D7): проходит валидацию
// и полный round-trip. Файл вне tsconfig пакетов: работает только через Vitest.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  deserializePlanFile,
  PLAN_FILE_FORMAT,
  serializePlanFile,
} from '../../../packages/gantt/src/native-plan-format';

const SAMPLE_PATH = 'tests/fixtures/gantt/native-plan-sample.json';

const sample = readFileSync(SAMPLE_PATH, 'utf8');

describe('эталонный файл native-plan-sample.json', () => {
  it('файл заявляет актуальный формат', () => {
    const envelope = JSON.parse(sample) as { format: string; formatVersion: number };
    expect(envelope.format).toBe(PLAN_FILE_FORMAT);
    expect(envelope.formatVersion).toBe(1);
  });

  it('десериализуется в полный план со всеми разделами', () => {
    const result = deserializePlanFile(sample);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.issues));
    }
    expect(result.payload.title).toBe('Малый контрольный набор');
    expect(result.payload.content.tasks).toHaveLength(5);
    expect(result.payload.content.groups).toHaveLength(1);
    expect(result.payload.content.resources).toHaveLength(2);
    expect(result.payload.content.workTypes).toHaveLength(2);
    expect(result.payload.content.dependencies).toHaveLength(2);
    expect(result.payload.content.unavailability).toHaveLength(1);
    expect(result.payload.content.calendar.holidays).toEqual(['2026-10-14']);
  });

  it('round-trip эталона даёт эквивалентный файл', () => {
    const first = deserializePlanFile(sample);
    if (!first.ok) {
      throw new Error(JSON.stringify(first.issues));
    }
    const reserialized = serializePlanFile(first.payload);
    const second = deserializePlanFile(reserialized.json);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error(JSON.stringify(second.issues));
    }
    expect(second.payload).toEqual(first.payload);
  });
});
