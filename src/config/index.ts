import type { ServerConfig } from '@/types/server.types';

// 환경변수에서 설정 로드
const loadConfig = (): ServerConfig => {
  const getEnvNumber = (key: string, defaultValue: number): number => {
    const value = process.env[key];
    return value ? parseInt(value, 10) : defaultValue;
  };

  const getEnvString = (key: string, defaultValue: string): string => {
    return process.env[key] || defaultValue;
  };

  const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
  };

  return {
    port: getEnvNumber('PORT', 1234),
    nodeEnv: getEnvString('NODE_ENV', 'development'),
    corsOrigin: getEnvString('CORS_ORIGIN', 'http://localhost:3000'),
    maxClientsPerRoom: getEnvNumber('MAX_CLIENTS_PER_ROOM', 50),
    websocketPingInterval: getEnvNumber('WEBSOCKET_PING_INTERVAL', 30000),
    websocketTimeout: getEnvNumber('WEBSOCKET_TIMEOUT', 5000),
    logLevel: getEnvString('LOG_LEVEL', 'info'),
    logFormat: getEnvString('LOG_FORMAT', 'combined'),
    cleanupInterval: getEnvNumber('CLEANUP_INTERVAL', 300000),
    // 코드 에디터 기능 추가
    apiBaseUrl: getEnvString('API_BASE_URL', 'http://localhost:3000/api'),
    gracePeriodMs: getEnvNumber('GRACE_PERIOD_MS', 120000), // 기본 2분
    enableCodeEditorFeatures: getEnvBoolean('ENABLE_CODE_EDITOR_FEATURES', true),
  };
};

// 설정 유효성 검증
const validateConfig = (config: ServerConfig): void => {
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}. Port must be between 1 and 65535.`);
  }

  if (config.maxClientsPerRoom < 1) {
    throw new Error(`Invalid maxClientsPerRoom: ${config.maxClientsPerRoom}. Must be at least 1.`);
  }

  if (config.websocketPingInterval < 1000) {
    throw new Error(
      `Invalid websocketPingInterval: ${config.websocketPingInterval}. Must be at least 1000ms.`,
    );
  }

  if (config.gracePeriodMs && config.gracePeriodMs < 5000) {
    throw new Error(`Invalid gracePeriodMs: ${config.gracePeriodMs}. Must be at least 5000ms.`);
  }

  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLogLevels.includes(config.logLevel)) {
    throw new Error(
      `Invalid logLevel: ${config.logLevel}. Must be one of: ${validLogLevels.join(', ')}`,
    );
  }

  // API URL 형식 검증 (코드 에디터 기능이 활성화된 경우)
  if (config.enableCodeEditorFeatures && config.apiBaseUrl) {
    try {
      new URL(config.apiBaseUrl);
    } catch {
      throw new Error(`Invalid apiBaseUrl: ${config.apiBaseUrl}. Must be a valid URL.`);
    }
  }
};

// 전역 설정 객체
const config = loadConfig();
validateConfig(config);

export default config;

// 개발환경 여부 확인
export const isDevelopment = (): boolean => config.nodeEnv === 'development';
export const isProduction = (): boolean => config.nodeEnv === 'production';

// 설정 정보 출력 (민감한 정보 제외)
export const getConfigSummary = (): Record<string, unknown> => ({
  port: config.port,
  nodeEnv: config.nodeEnv,
  maxClientsPerRoom: config.maxClientsPerRoom,
  websocketPingInterval: config.websocketPingInterval,
  logLevel: config.logLevel,
  enableCodeEditorFeatures: config.enableCodeEditorFeatures,
  gracePeriodMs: config.gracePeriodMs,
  apiBaseUrl: config.apiBaseUrl ? '[CONFIGURED]' : '[NOT_SET]',
});
