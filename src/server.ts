import 'dotenv/config';
import { WebSocketServer } from 'ws';
import config, { getConfigSummary } from '@/config';
import logger from '@/utils/logger';
import { checkPort } from '@/utils/portChecker';
import { RoomManager } from '@/utils/roomManager';
import { setupErrorHandlers } from '@/middleware/errorHandler';
import type { ExtendedWebSocket, ServerError } from '@/types/server.types';

// 전역 변수
const roomManager = new RoomManager();

/**
 * WebSocket 서버 시작
 */
const startServer = async (): Promise<void> => {
  try {
    logger.info('Yjs Collaboration Server 시작 중...');
    logger.info('서버 설정', getConfigSummary());

    // 포트 사용 가능 여부 확인
    const isPortAvailable = await checkPort(config.port);
    if (!isPortAvailable) {
      logger.error(`포트 ${config.port}가 이미 사용 중입니다.`);
      logger.info('포트 해제 명령어:', `lsof -ti:${config.port} | xargs kill -9`);
      process.exit(1);
    }

    // WebSocket 서버 생성
    const wss = new WebSocketServer({
      port: config.port,
      perMessageDeflate: false,
    });

    // 클라이언트 연결 처리
    wss.on('connection', handleClientConnection);

    // 서버 이벤트 처리
    wss.on('error', (error: Error) => {
      logger.error('WebSocket 서버 에러', error);
    });

    wss.on('listening', () => {
      logger.serverStatus(`서버가 포트 ${config.port}에서 실행 중입니다.`);
      logger.info(`클라이언트 연결 URL: ws://localhost:${config.port}`);
      logger.info('서버를 종료하려면 Ctrl+C를 누르세요.');
    });

    // 주기적으로 빈 방 정리
    setInterval(() => {
      const cleanedRooms = roomManager.cleanupEmptyRooms();
      if (cleanedRooms > 0) {
        logger.debug(`빈 방 ${cleanedRooms}개 정리 완료`);
      }
    }, config.cleanupInterval);

    // 서버 상태 모니터링 (개발환경에서만)
    if (config.nodeEnv === 'development') {
      setInterval(() => {
        const status = roomManager.getServerStatus();
        logger.debug('서버 상태', status);
      }, 60000); // 1분마다
    }
  } catch (error) {
    const serverError = error as ServerError;
    logger.error('서버 시작 실패', {
      message: serverError.message,
      code: serverError.code,
      stack: serverError.stack,
    });
    process.exit(1);
  }
};

/**
 * 클라이언트 연결 처리
 */
const handleClientConnection = (ws: ExtendedWebSocket, request: Request): void => {
  try {
    // URL에서 방 ID 추출
    const url = request.url || '';
    const roomId = url.substring(1) || 'default';
    const clientIP = (request as any).socket?.remoteAddress || 'unknown';
    const clientId = generateClientId();

    // 클라이언트 정보 설정
    ws.roomId = roomId;
    ws.clientId = clientId;
    ws.isAlive = true;

    logger.connection(roomId, `새 클라이언트 연결 (ID: ${clientId}, IP: ${clientIP})`);

    // 방에 클라이언트 추가
    const clientCount = roomManager.addClient(roomId, ws);
    logger.roomActivity(roomId, clientCount, '클라이언트 추가');

    // 방 인원 제한 확인
    if (clientCount > config.maxClientsPerRoom) {
      logger.warn(
        `방 ${roomId}의 클라이언트 수가 제한을 초과했습니다 (${clientCount}/${config.maxClientsPerRoom})`,
      );
      ws.close(1008, 'Room capacity exceeded');
      return;
    }

    // 메시지 수신 처리
    ws.on('message', (message: Buffer) => {
      handleClientMessage(ws, message);
    });

    // 연결 종료 처리
    ws.on('close', (code: number, reason: Buffer) => {
      handleClientDisconnection(ws, code, reason);
    });

    // 에러 처리
    ws.on('error', (error: Error) => {
      logger.error(`클라이언트 에러 (${roomId}/${clientId})`, error);
    });

    // Ping/Pong 처리 (연결 상태 확인)
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  } catch (error) {
    logger.error('클라이언트 연결 처리 중 오류', error);
    ws.close(1011, 'Server error during connection setup');
  }
};

/**
 * 클라이언트 메시지 처리
 */
const handleClientMessage = (ws: ExtendedWebSocket, message: Buffer): void => {
  try {
    const { roomId, clientId } = ws;
    if (!roomId || !clientId) return;

    const messageStr = message.toString();
    logger.debug(`메시지 수신 (${roomId}/${clientId})`, {
      size: message.length,
      preview: messageStr.substring(0, 50) + (messageStr.length > 50 ? '...' : ''),
    });

    // 같은 방의 다른 클라이언트들에게 브로드캐스트
    const broadcastCount = roomManager.broadcast(roomId, message, ws);

    if (broadcastCount > 0) {
      logger.debug(`메시지 브로드캐스트 완료: ${broadcastCount}명에게 전송`);
    }
  } catch (error) {
    logger.error('메시지 처리 중 오류', {
      roomId: ws.roomId,
      clientId: ws.clientId,
      error: error,
    });
  }
};

/**
 * 클라이언트 연결 종료 처리
 */
const handleClientDisconnection = (ws: ExtendedWebSocket, code: number, reason: Buffer): void => {
  try {
    const { roomId, clientId } = ws;
    if (!roomId || !clientId) return;

    logger.connection(roomId, `클라이언트 연결 종료 (ID: ${clientId}, 코드: ${code})`);

    // 방에서 클라이언트 제거
    const clientCount = roomManager.removeClient(roomId, ws);

    if (clientCount === 0) {
      logger.roomActivity(roomId, 0, '방이 비워짐');
    } else {
      logger.roomActivity(roomId, clientCount, '클라이언트 제거');
    }
  } catch (error) {
    logger.error('클라이언트 연결 종료 처리 중 오류', error);
  }
};

/**
 * 고유한 클라이언트 ID 생성
 */
const generateClientId = (): string => {
  return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * 정기적인 Ping 전송 (연결 상태 확인)
 */
const setupHeartbeat = (wss: WebSocketServer): void => {
  const interval = setInterval(() => {
    wss.clients.forEach((ws: ExtendedWebSocket) => {
      if (!ws.isAlive) {
        logger.debug(`비활성 연결 종료: ${ws.roomId}/${ws.clientId}`);
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, config.websocketPingInterval);

  wss.on('close', () => {
    clearInterval(interval);
  });
};

// 에러 핸들러 설정
setupErrorHandlers();

// 서버 시작
startServer().catch(error => {
  logger.error('서버 시작 중 예외 발생', error);
  process.exit(1);
});
