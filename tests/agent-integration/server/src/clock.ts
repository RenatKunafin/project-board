/** Часы стенда: системные в бою, управляемые в тестах. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export class ManualClock implements Clock {
  private current: number;

  constructor(start: number = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
