import logger from '@/utils/logger';

/**
 * 전역 에러 핸들러 설정
 */
export const setupErrorHandlers = (): void => {
  // 예외가 발생했을 때의 처리
  process.on('uncaughtException', (error: Error) => {
    logger.error('처리되지 않은 예외 발생', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    // 예외 발생 시 안전하게 서버 종료
    gracefulShutdown('uncaughtException');
  });

  // Promise rejection이 처리되지 않았을 때
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error('처리되지 않은 Promise 거부', {
      reason: reason instanceof Error ? reason.message : String(reason),
      promise: promise.toString(),
    });

    // Promise rejection은 바로 종료하지 않고 로깅만
    // 필요시 gracefulShutdown 호출 가능
  });

  // SIGTERM 신호 처리 (정상적인 종료 요청)
  process.on('SIGTERM', () => {
    logger.info('SIGTERM 신호 수신: 서버 종료 중...');
    gracefulShutdown('SIGTERM');
  });

  // SIGINT 신호 처리 (Ctrl+C)
  process.on('SIGINT', () => {
    logger.info('SIGINT 신호 수신: 서버 종료 중...');
    gracefulShutdown('SIGINT');
  });

  // SIGUSR2 신호 처리 (nodemon 재시작)
  process.on('SIGUSR2', () => {
    logger.info('SIGUSR2 신호 수신: 개발 서버 재시작...');
    gracefulShutdown('SIGUSR2');
  });

  logger.debug('전역 에러 핸들러 설정 완료');
};

/**
 * 안전한 서버 종료
 */
const gracefulShutdown = (signal: string): void => {
  logger.info(`안전한 서버 종료 시작 (신호: ${signal})`);

  // 종료 타임아웃 설정 (최대 30초)
  const forceExitTimer = setTimeout(() => {
    logger.error('강제 종료: 타임아웃으로 인한 프로세스 종료');
    process.exit(1);
  }, 30000);

  // 정상 종료 프로세스
  Promise.resolve()
    .then(() => {
      // 여기서 추가적인 정리 작업 수행 가능
      // 예: 데이터베이스 연결 종료, 진행 중인 작업 완료 대기 등
      logger.info('서버 리소스 정리 중...');

      // 예시: 룸 매니저 종료 (실제 구현에서는 전역 인스턴스 참조 필요)
      // roomManager.shutdown();

      return new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
    })
    .then(() => {
      clearTimeout(forceExitTimer);
      logger.info('서버 종료 완료');
      process.exit(0);
    })
    .catch(error => {
      logger.error('서버 종료 중 오류 발생', error);
      clearTimeout(forceExitTimer);
      process.exit(1);
    });
};

/**
 * 에러 객체를 안전하게 직렬화
 */
export const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return { ...error };
  }

  return { error: String(error) };
};

/**
 * WebSocket 에러 핸들러
 */
export const handleWebSocketError = (error: Error, roomId?: string, clientId?: string): void => {
  const context = {
    roomId: roomId || 'unknown',
    clientId: clientId || 'unknown',
    ...serializeError(error),
  };

  logger.error('WebSocket 에러 발생', context);
};

/**
 * 개발환경에서의 상세 에러 로깅
 */
export const handleDevelopmentError = (error: unknown, context?: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('개발환경 상세 에러', {
      error: serializeError(error),
      context: context || {},
      timestamp: new Date().toISOString(),
    });
  }
};
