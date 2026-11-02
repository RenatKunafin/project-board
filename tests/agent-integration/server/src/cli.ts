#!/usr/bin/env node
import { startProbeComponent } from './run.js';

function usage(): never {
  process.stderr.write(`project-board-agent-probe — компонент синтетической пробы PBT-121.

Использование:
  project-board-agent-probe --allowed-origin <origin> [--port <port>]

Аргументы:
  --allowed-origin  Точный origin браузерной страницы стенда (https://… или http://…), обязателен.
  --port            Порт loopback-канала (по умолчанию 43821; 0 — эфемерный порт для тестов).

Компонент слушает только 127.0.0.1; stdout занят MCP stdio, служебные записи пишутся в stderr.
`);
  process.exit(2);
}

interface CliArgs {
  readonly port: number;
  readonly allowedOrigin: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let port = 43821;
  let allowedOrigin = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') usage();
    if (arg === '--port') {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        process.stderr.write('Некорректный --port: ожидается целое 0..65535.\n');
        process.exit(2);
      }
      port = parsed;
      index += 1;
      continue;
    }
    if (arg === '--allowed-origin') {
      const value = argv[index + 1];
      if (value === undefined || !/^https?:\/\/[^/]+(:\d+)?$/.test(value)) {
        process.stderr.write('Некорректный --allowed-origin: ожидается точный origin без пути, например https://example.github.io.\n');
        process.exit(2);
      }
      allowedOrigin = value;
      index += 1;
      continue;
    }
    process.stderr.write(`Неизвестный аргумент: ${arg}\n`);
    usage();
  }
  if (allowedOrigin === '') {
    process.stderr.write('--allowed-origin обязателен.\n');
    usage();
  }
  return { port, allowedOrigin };
}

const args = parseArgs(process.argv.slice(2));

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  process.stderr.write(`${JSON.stringify({ event: 'shutdown' })}\n`);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
// Клиент MCP закрыл stdio — компонент обязан завершиться (HTTP listener держит процесс).
process.stdin.on('close', () => void shutdown());

try {
  await startProbeComponent(args);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    process.stderr.write(`Порт ${args.port} уже занят; компонент не перебирает порты и не завершает чужие службы.\n`);
    process.exit(1);
  }
  process.stderr.write(`Компонент не запущен: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
