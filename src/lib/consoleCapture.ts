export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: string;
}

const BUFFER_LIMIT = 100;
const buffer: ConsoleEntry[] = [];
let initialized = false;

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function record(level: ConsoleLevel, args: unknown[]) {
  buffer.push({
    level,
    message: args.map(serializeArg).join(' '),
    timestamp: new Date().toISOString(),
  });
  if (buffer.length > BUFFER_LIMIT) {
    buffer.shift();
  }
}

export function initConsoleCapture(): void {
  if (initialized) return;
  initialized = true;

  (['log', 'info', 'warn', 'error'] as ConsoleLevel[]).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  });
}

export function getConsoleBuffer(): ConsoleEntry[] {
  return [...buffer];
}
