import { WebSocketServer } from 'ws';
import logger from '@/utils/logger';

/**
 * 지정된 포트가 사용 가능한지 확인
 */
export const checkPort = async (port: number): Promise<boolean> => {
  return new Promise(resolve => {
    const testServer = new WebSocketServer({ port }, (error?: Error) => {
      if (error) {
        logger.debug(`포트 ${port} 사용 불가`, { error: error.message });
        resolve(false);
      } else {
        testServer.close(() => {
          logger.debug(`포트 ${port} 사용 가능`);
          resolve(true);
        });
      }
    });

    // 에러 이벤트 핸들러
    testServer.on('error', (error: Error) => {
      logger.debug(`포트 ${port} 테스트 중 에러`, { error: error.message });
      resolve(false);
    });
  });
};

/**
 * 사용 가능한 포트 찾기 (지정된 포트부터 시작해서 순차적으로 확인)
 */
export const findAvailablePort = async (
  startPort: number,
  maxAttempts = 10,
): Promise<number | null> => {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const isAvailable = await checkPort(port);

    if (isAvailable) {
      logger.info(`사용 가능한 포트 발견: ${port}`);
      return port;
    }
  }

  logger.error(`${startPort}부터 ${maxAttempts}개 포트 중 사용 가능한 포트를 찾을 수 없습니다.`);
  return null;
};

/**
 * 포트가 유효한 범위 내에 있는지 확인
 */
export const isValidPort = (port: number): boolean => {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
};

/**
 * 포트 사용 중인 프로세스 찾기 (Unix 계열 시스템)
 */
export const getPortProcess = async (port: number): Promise<string | null> => {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(`lsof -ti:${port}`);
    const pid = stdout.trim();

    if (pid) {
      const { stdout: processInfo } = await execAsync(`ps -p ${pid} -o comm=`);
      return `PID ${pid} (${processInfo.trim()})`;
    }

    return null;
  } catch (error) {
    logger.debug('포트 프로세스 정보 조회 실패', { port, error });
    return null;
  }
};
