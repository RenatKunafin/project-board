import { afterAll, describe, expect, it } from 'vitest';
import { startProbeComponent, type ProbeComponent } from './run.js';

const components: ProbeComponent[] = [];

afterAll(async () => {
  for (const component of components) await component.close();
});

describe('startProbeComponent: loopback-процесс', () => {
  it('поднимается на 127.0.0.1 с эфемерным портом и закрывается', async () => {
    const component = await startProbeComponent({ port: 0, allowedOrigin: 'http://localhost:4390' });
    components.push(component);
    expect(component.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(component.runId.length).toBeGreaterThan(10);
    const response = await fetch(`${component.address}/requests`, { method: 'POST' });
    expect(response.status).toBe(403); // без Origin отклоняется
  });

  it('занятый порт даёт явную ошибку и не перебирает порты', async () => {
    const first = await startProbeComponent({ port: 0, allowedOrigin: 'http://localhost:4390' });
    components.push(first);
    await expect(startProbeComponent({ port: first.port, allowedOrigin: 'http://localhost:4390' })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  });

  it('close освобождает порт для следующего запуска', async () => {
    const first = await startProbeComponent({ port: 0, allowedOrigin: 'http://localhost:4390' });
    const port = first.port;
    await first.close();
    const second = await startProbeComponent({ port, allowedOrigin: 'http://localhost:4390' });
    components.push(second);
    expect(second.port).toBe(port);
    expect(second.runId).not.toBe(first.runId);
  });
});
