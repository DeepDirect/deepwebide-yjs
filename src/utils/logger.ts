import config from '@/config';
import type { LogLevel } from '@/types/server.types';

// 로그 레벨 우선순위
const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// 로그 색상 (개발환경용)
const LOG_COLORS: Record<LogLevel, string> = {
  error: '\x1b[31m', // 빨강
  warn: '\x1b[33m', // 노랑
  info: '\x1b[36m', // 청록
  debug: '\x1b[37m', // 흰색
};

const RESET_COLOR = '\x1b[0m';

class Logger {
  private currentLevel: number;
  private isDev: boolean;

  constructor() {
    this.currentLevel = LOG_LEVELS[config.logLevel as LogLevel] ?? LOG_LEVELS.info;
    this.isDev = config.nodeEnv === 'development';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= this.currentLevel;
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelText = level.toUpperCase().padEnd(5);

    let logMessage = `[${timestamp}] ${levelText} ${message}`;

    if (data !== undefined) {
      const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
      logMessage += `\n${dataStr}`;
    }

    // 개발환경에서 색상 적용
    if (this.isDev) {
      return `${LOG_COLORS[level]}${logMessage}${RESET_COLOR}`;
    }

    return logMessage;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, message, data);

    // error와 warn은 stderr로, 나머지는 stdout으로
    if (level === 'error' || level === 'warn') {
      console.error(formattedMessage);
    } else {
      console.log(formattedMessage);
    }
  }

  // 공개 메서드들
  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  // WebSocket 전용 로깅 메서드들
  connection(roomId: string, action: string, details?: unknown): void {
    this.info(`[${roomId}] ${action}`, details);
  }

  roomActivity(roomId: string, clientCount: number, action: string): void {
    this.info(`[${roomId}] ${action} (클라이언트: ${clientCount}명)`);
  }

  serverStatus(message: string, status?: unknown): void {
    this.info(`[SERVER] ${message}`, status);
  }
}

// 싱글톤 인스턴스 생성
const logger = new Logger();

export default logger;
