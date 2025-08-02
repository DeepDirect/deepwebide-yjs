import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import config, { getConfigSummary } from '@/config';
import logger from '@/utils/logger';
import { checkPort } from '@/utils/portChecker';
import { RoomManager } from '@/utils/roomManager';
import type { ExtendedWebSocket, ServerError } from '@/types/server.types';

const roomManager = new RoomManager();
const connectionTracker = new Map<string, Map<string, number>>();
const MAX_CONNECTIONS_PER_IP_PER_ROOM = 10;

const isCodeEditorRoom = (roomId: string): boolean => {
  return /^repo-\d+(-.*)?$/.test(roomId);
};

const isFileTreeRoom = (roomId: string): boolean => {
  return /^filetree-\d+$/.test(roomId);
};

const isSavePointRoom = (roomId: string): boolean => {
  return /^savepoint-\d+$/.test(roomId);
};

const isAllowedRoom = (roomId: string): boolean => {
  return isCodeEditorRoom(roomId) || isFileTreeRoom(roomId) || isSavePointRoom(roomId);
};

const trackConnection = (clientIP: string, roomId: string): boolean => {
  if (!connectionTracker.has(clientIP)) {
    connectionTracker.set(clientIP, new Map());
  }

  const ipRooms = connectionTracker.get(clientIP)!;
  const currentCount = ipRooms.get(roomId) || 0;

  if (currentCount >= MAX_CONNECTIONS_PER_IP_PER_ROOM) {
    return false;
  }

  ipRooms.set(roomId, currentCount + 1);
  return true;
};

const untrackConnection = (clientIP: string, roomId: string): void => {
  const ipRooms = connectionTracker.get(clientIP);
  if (ipRooms) {
    const currentCount = ipRooms.get(roomId) || 0;
    if (currentCount <= 1) {
      ipRooms.delete(roomId);
      if (ipRooms.size === 0) {
        connectionTracker.delete(clientIP);
      }
    } else {
      ipRooms.set(roomId, currentCount - 1);
    }
  }
};

const startServer = async (): Promise<void> => {
  try {
    logger.info('Yjs Collaboration Server 시작 중...');
    logger.info('서버 설정', getConfigSummary());

    const isPortAvailable = await checkPort(config.port);
    if (!isPortAvailable) {
      logger.error(`포트 ${config.port}가 이미 사용 중입니다.`);
      logger.info('포트 해제 명령어:', `lsof -ti:${config.port} | xargs kill -9`);
      process.exit(1);
    }

    const wss = new WebSocketServer({
      port: config.port,
      perMessageDeflate: false,
    });

    wss.on('connection', (ws, request) => {
      handleClientConnection(ws as ExtendedWebSocket, request as IncomingMessage);
    });

    wss.on('error', (error: Error) => {
      logger.error('WebSocket 서버 에러', error);
    });

    wss.on('listening', () => {
      logger.serverStatus(`서버가 포트 ${config.port}에서 실행 중입니다.`);
      logger.info(`클라이언트 연결 URL: ws://localhost:${config.port}`);
      logger.info('서버를 종료하려면 Ctrl+C를 누르세요.');
    });

    setupHeartbeat(wss);
    setupCleanupInterval();
    setupGracefulShutdown(wss);
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

const handleClientConnection = (ws: ExtendedWebSocket, request: IncomingMessage): void => {
  const clientIP = request.socket?.remoteAddress || 'unknown';

  try {
    const url = request.url || '';
    const roomId = url.substring(1) || 'default';
    const clientId = generateClientId();

    if (roomId !== 'default' && !isAllowedRoom(roomId)) {
      const roomType = isCodeEditorRoom(roomId)
        ? '코드에디터'
        : isFileTreeRoom(roomId)
          ? '파일트리'
          : '알수없음';
      logger.warn(`비허용 룸 연결 시도 거부: ${roomId} (타입: ${roomType}, IP: ${clientIP})`);
      ws.close(1008, 'Unauthorized room access');
      return;
    }

    if (roomId === 'default') {
      logger.debug(`테스트 연결 감지, 즉시 종료: ${clientIP}`);
      ws.close(1000, 'Test connection');
      return;
    }

    if (!trackConnection(clientIP, roomId)) {
      logger.warn(
        `IP별 룸별 연결 제한 초과: ${clientIP} -> ${roomId} (최대 ${MAX_CONNECTIONS_PER_IP_PER_ROOM}개)`,
      );
      ws.close(1008, 'Too many connections per IP per room');
      return;
    }

    const currentClientCount = roomManager.getActiveClientCount(roomId);
    if (currentClientCount >= config.maxClientsPerRoom) {
      logger.warn(
        `방 클라이언트 제한 초과: ${roomId} (${currentClientCount}/${config.maxClientsPerRoom})`,
      );
      untrackConnection(clientIP, roomId);
      ws.close(1008, 'Room capacity exceeded');
      return;
    }

    ws.roomId = roomId;
    ws.clientId = clientId;
    ws.isAlive = true;
    ws.connectedAt = new Date();
    ws.lastActivity = new Date();

    if (!ws.socket) {
      ws.socket = { remoteAddress: clientIP };
    }

    const roomType = isCodeEditorRoom(roomId) ? '코드에디터' : '파일트리';
    logger.connection(
      roomId,
      `새 클라이언트 연결 (ID: ${clientId}, 타입: ${roomType}, IP: ${clientIP})`,
    );

    const clientCount = roomManager.addClient(roomId, ws);
    logger.roomActivity(roomId, clientCount, '클라이언트 추가');

    const totalStatus = roomManager.getServerStatus();
    logger.info(`전체 서버 상태: 총 ${totalStatus.totalClients}명 접속 중`);

    ws.on('message', (message: Buffer) => {
      handleClientMessage(ws, message);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      handleClientDisconnection(ws, code, reason);
    });

    ws.on('error', (error: Error) => {
      logger.error(`클라이언트 에러 (${roomId}/${clientId})`, {
        error: error.message,
        stack: error.stack,
      });
      handleClientDisconnection(ws, 1011, Buffer.from('Client error'));
    });

    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastActivity = new Date();
    });
  } catch (error) {
    logger.error('클라이언트 연결 처리 중 오류', {
      error: error instanceof Error ? error.message : String(error),
      url: request.url,
      clientIP,
    });

    try {
      ws.close(1011, 'Server error during connection setup');
    } catch (closeError) {
      logger.error('연결 해제 중 오류', closeError);
    }
  }
};

const handleClientMessage = (ws: ExtendedWebSocket, message: Buffer): void => {
  try {
    const { roomId, clientId } = ws;
    if (!roomId || !clientId) return;

    ws.lastActivity = new Date();

    // 파일트리 메시지인지 확인
    try {
      const messageText = message.toString('utf8');
      const parsedMessage = JSON.parse(messageText);

      // 파일트리 브로드캐스트 메시지 처리
      if (parsedMessage.type === 'fileTree' && isFileTreeRoom(roomId)) {
        logger.debug(`파일트리 브로드캐스트: ${roomId}`, {
          action: parsedMessage.action,
          fileId: parsedMessage.data?.fileId,
          fileName: parsedMessage.data?.fileName,
        });

        // 파일트리 메시지는 모든 클라이언트에게 브로드캐스트
        const broadcastCount = roomManager.broadcast(roomId, message, ws);

        if (broadcastCount > 0) {
          logger.debug(`파일트리 메시지 브로드캐스트: ${broadcastCount}명에게 전송`);
        }
        return;
      }
    } catch (parseError) {
      // JSON 파싱 실패는 일반적인 Yjs 메시지이므로 기존 로직 계속 진행
    }

    // 기존 Yjs 메시지 처리
    const broadcastCount = roomManager.broadcast(roomId, message, ws);

    if (broadcastCount > 0) {
      logger.debug(`메시지 브로드캐스트: ${broadcastCount}명에게 전송`);
    }
  } catch (error) {
    logger.error('메시지 처리 중 오류', {
      roomId: ws.roomId,
      clientId: ws.clientId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleClientDisconnection = (ws: ExtendedWebSocket, code: number, reason: Buffer): void => {
  try {
    const { roomId, clientId } = ws;
    if (!roomId || !clientId) return;

    logger.connection(roomId, `클라이언트 연결 종료 (ID: ${clientId}, 코드: ${code})`);

    const clientCount = roomManager.removeClient(roomId, ws);

    const clientIP = ws.socket?.remoteAddress || 'unknown';
    untrackConnection(clientIP, roomId);

    if (clientCount === 0) {
      logger.roomActivity(roomId, 0, '방이 비워짐');
    } else {
      logger.roomActivity(roomId, clientCount, '클라이언트 제거');
    }

    const totalStatus = roomManager.getServerStatus();
    logger.info(`클라이언트 제거 후 상태: 총 ${totalStatus.totalClients}명 접속 중`);
  } catch (error) {
    logger.error('클라이언트 연결 종료 처리 중 오류', {
      error: error instanceof Error ? error.message : String(error),
      roomId: ws.roomId,
      clientId: ws.clientId,
    });
  }
};

const generateClientId = (): string => {
  return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

const setupHeartbeat = (wss: WebSocketServer): void => {
  const interval = setInterval(() => {
    let terminatedCount = 0;
    let pingCount = 0;

    wss.clients.forEach((ws: ExtendedWebSocket) => {
      try {
        if (!ws.isAlive || ws.readyState !== 1 || !ws.roomId || !ws.clientId) {
          logger.debug(`비활성 연결 종료: ${ws.roomId}/${ws.clientId}`);
          ws.terminate();
          terminatedCount++;
          return;
        }

        ws.isAlive = false;
        ws.ping();
        pingCount++;
      } catch (pingError) {
        logger.warn(`Ping 전송 실패: ${ws.roomId}/${ws.clientId}`);
        try {
          ws.terminate();
          terminatedCount++;
        } catch (terminateError) {
          logger.error(`연결 종료 실패: ${ws.roomId}/${ws.clientId}`, terminateError);
        }
      }
    });

    if (terminatedCount > 0) {
      logger.info(`Heartbeat: ${pingCount}개 전송, ${terminatedCount}개 연결 종료`);

      const status = roomManager.getServerStatus();
      logger.info(`Heartbeat 후 상태: 활성 클라이언트 ${status.totalClients}명`);
    }
  }, config.websocketPingInterval);

  process.on('SIGINT', () => clearInterval(interval));
  process.on('SIGTERM', () => clearInterval(interval));
};

const setupCleanupInterval = (): void => {
  setInterval(() => {
    const cleanedClients = roomManager.cleanupInactiveClients();
    const cleanedRooms = roomManager.cleanupEmptyRooms();

    if (cleanedClients > 0 || cleanedRooms > 0) {
      logger.info(`정리 완료: 클라이언트 ${cleanedClients}개, 방 ${cleanedRooms}개`);

      const status = roomManager.getServerStatus();
      logger.info(
        `정리 후 서버 상태: 방 ${status.totalRooms}개, 활성 클라이언트 ${status.totalClients}명`,
      );
    }

    const status = roomManager.getServerStatus();
    if (status.totalClients > 100) {
      logger.warn(`비정상적인 클라이언트 수 감지: ${status.totalClients}명`);
      const forceCleaned = roomManager.forceCleanupAll();
      logger.info(`강제 정리 완료: ${forceCleaned}개 연결 해제`);

      connectionTracker.clear();
      logger.info('연결 추적 정보 초기화');
    }
  }, 20000);

  if (config.nodeEnv === 'development') {
    setInterval(() => {
      const status = roomManager.getServerStatus();
      logger.info(
        `[정기 체크] 서버 상태: 방 ${status.totalRooms}개, 활성 클라이언트 ${status.totalClients}명`,
      );

      if (status.totalClients > 20) {
        const connectionSummary = Array.from(connectionTracker.entries()).map(([ip, rooms]) => ({
          ip: ip.substring(0, 10) + '...',
          totalConnections: Array.from(rooms.values()).reduce((sum, count) => sum + count, 0),
          roomCount: rooms.size,
        }));

        if (connectionSummary.length > 0) {
          logger.debug('연결 추적 요약:', connectionSummary.slice(0, 5));
        }
      }
    }, 300000);
  }
};

const setupGracefulShutdown = (wss: WebSocketServer): void => {
  const shutdown = () => {
    logger.info('서버 종료 신호 받음...');

    wss.clients.forEach(ws => {
      try {
        ws.close(1001, 'Server shutting down');
      } catch (error) {
        logger.warn('연결 해제 실패', error);
      }
    });

    roomManager.shutdown();
    connectionTracker.clear();

    wss.close(() => {
      logger.info('서버 종료 완료');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('강제 종료');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

startServer().catch(error => {
  logger.error('서버 시작 중 예외 발생', error);
  process.exit(1);
});
