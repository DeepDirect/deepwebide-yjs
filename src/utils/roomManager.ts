import type { ExtendedWebSocket, RoomInfo, ServerStatus } from '@/types/server.types';
import logger from '@/utils/logger';
import { SaveManager } from '@/utils/saveManager';
import { YjsDocumentManager } from '@/utils/yjsDocumentManager';

export class RoomManager {
  private rooms: Map<string, RoomInfo> = new Map();
  private gracePeriods: Map<string, NodeJS.Timeout> = new Map();
  private saveManager: SaveManager;
  private yjsManager: YjsDocumentManager;
  private gracePeriodMs: number;

  constructor() {
    this.saveManager = new SaveManager();
    this.yjsManager = new YjsDocumentManager();
    this.gracePeriodMs = parseInt(process.env.GRACE_PERIOD_MS || '120000', 10);
  }

  addClient(roomId: string, client: ExtendedWebSocket): number {
    if (this.gracePeriods.has(roomId)) {
      clearTimeout(this.gracePeriods.get(roomId)!);
      this.gracePeriods.delete(roomId);
      logger.info(`Grace Period 취소: ${roomId}`);
    }

    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        clients: new Set(),
        createdAt: new Date(),
        lastActivity: new Date(),
      });

      const roomType = SaveManager.isCodeEditorRoom(roomId)
        ? '코드에디터'
        : SaveManager.isFileTreeRoom(roomId)
          ? '파일트리'
          : '기타';
      logger.info(`새 방 생성: ${roomId} (타입: ${roomType})`);
    }

    const room = this.rooms.get(roomId)!;

    if (room.clients.has(client)) {
      logger.debug(`클라이언트 이미 존재: ${roomId}/${client.clientId}`);
      return this.getActiveClientCount(roomId);
    }

    room.clients.add(client);
    room.lastActivity = new Date();

    const activeCount = this.getActiveClientCount(roomId);
    logger.debug(`클라이언트 추가: ${roomId}/${client.clientId} (활성 ${activeCount}명)`);

    return activeCount;
  }

  removeClient(roomId: string, client: ExtendedWebSocket): number {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }

    if (!room.clients.has(client)) {
      return this.getActiveClientCount(roomId);
    }

    room.clients.delete(client);
    room.lastActivity = new Date();

    const remainingCount = this.getActiveClientCount(roomId);
    logger.debug(`클라이언트 제거: ${roomId}/${client.clientId} (활성 ${remainingCount}명)`);

    if (remainingCount === 0) {
      this.startGracePeriod(roomId);
    }

    return remainingCount;
  }

  private startGracePeriod(roomId: string): void {
    if (SaveManager.isFileTreeRoom(roomId)) {
      logger.info(`파일 트리 룸 즉시 정리: ${roomId}`);
      this.cleanupRoom(roomId);
      return;
    }

    if (!SaveManager.isCodeEditorRoom(roomId)) {
      logger.info(`알 수 없는 룸 타입 즉시 정리: ${roomId}`);
      this.cleanupRoom(roomId);
      return;
    }

    logger.info(`Grace Period 시작: ${roomId} (${this.gracePeriodMs / 1000}초)`);

    const timeout = setTimeout(() => {
      try {
        const room = this.rooms.get(roomId);

        if (!room || this.getActiveClientCount(roomId) === 0) {
          this.cleanupRoom(roomId);
          logger.info(`Grace Period 완료: ${roomId} 정리됨`);
        } else {
          logger.info(
            `Grace Period 종료, 사용자 있음: ${roomId} (${this.getActiveClientCount(roomId)}명)`,
          );
        }

        this.gracePeriods.delete(roomId);
      } catch (error) {
        logger.error(`Grace Period 처리 실패: ${roomId}`, error);
        this.cleanupRoom(roomId);
        this.gracePeriods.delete(roomId);
      }
    }, this.gracePeriodMs);

    this.gracePeriods.set(roomId, timeout);
  }

  private cleanupRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    let terminatedCount = 0;
    room.clients.forEach(client => {
      try {
        if (client.readyState === 1) {
          client.close(1000, 'Room cleanup');
        }
        terminatedCount++;
      } catch (error) {
        logger.warn(`클라이언트 종료 실패: ${roomId}/${client.clientId}`, error);
      }
    });

    this.rooms.delete(roomId);

    if (SaveManager.isCodeEditorRoom(roomId)) {
      this.yjsManager.cleanupDocument(roomId);
    }

    logger.info(`방 정리 완료: ${roomId} (${terminatedCount}개 연결 종료)`);
  }

  broadcast(roomId: string, message: Buffer, sender: ExtendedWebSocket): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    if (SaveManager.isCodeEditorRoom(roomId)) {
      this.yjsManager.handleYjsMessage(roomId, message);
    }

    let broadcastCount = 0;
    const deadClients: ExtendedWebSocket[] = [];

    room.clients.forEach(client => {
      if (client !== sender) {
        if (client.readyState === 1) {
          try {
            client.send(message);
            broadcastCount++;
          } catch (error) {
            logger.error(`메시지 전송 실패: ${roomId}/${client.clientId}`, error);
            deadClients.push(client);
          }
        } else {
          deadClients.push(client);
        }
      }
    });

    deadClients.forEach(deadClient => {
      room.clients.delete(deadClient);
      logger.debug(`죽은 클라이언트 제거: ${roomId}/${deadClient.clientId}`);
    });

    room.lastActivity = new Date();
    return broadcastCount;
  }

  cleanupInactiveClients(): number {
    let cleanedCount = 0;

    this.rooms.forEach((room, roomId) => {
      const deadClients: ExtendedWebSocket[] = [];

      room.clients.forEach(client => {
        if (
          client.readyState !== 1 ||
          client.isAlive === false ||
          !client.clientId ||
          !client.roomId
        ) {
          deadClients.push(client);
        }
      });

      const beforeSize = room.clients.size;
      deadClients.forEach(deadClient => {
        room.clients.delete(deadClient);
        cleanedCount++;
        logger.debug(`비활성 클라이언트 정리: ${roomId}/${deadClient.clientId || 'unknown'}`);
      });

      const afterSize = room.clients.size;
      if (beforeSize !== afterSize && afterSize === 0) {
        this.startGracePeriod(roomId);
      }
    });

    return cleanedCount;
  }

  cleanupEmptyRooms(): number {
    let cleanedCount = 0;

    this.rooms.forEach((room, roomId) => {
      if (this.getActiveClientCount(roomId) === 0 && !this.gracePeriods.has(roomId)) {
        this.cleanupRoom(roomId);
        cleanedCount++;
      }
    });

    return cleanedCount;
  }

  getClientCount(roomId: string): number {
    return this.getActiveClientCount(roomId);
  }

  getActiveClientCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    let activeCount = 0;
    room.clients.forEach(client => {
      if (client.readyState === 1 && client.isAlive !== false && client.clientId && client.roomId) {
        activeCount++;
      }
    });

    return activeCount;
  }

  getServerStatus(): ServerStatus {
    let totalActiveClients = 0;

    this.rooms.forEach(room => {
      totalActiveClients += this.getActiveClientCount(room.id);
    });

    const codeEditorRooms = Array.from(this.rooms.keys()).filter(roomId =>
      SaveManager.isCodeEditorRoom(roomId),
    ).length;

    const fileTreeRooms = Array.from(this.rooms.keys()).filter(roomId =>
      SaveManager.isFileTreeRoom(roomId),
    ).length;

    return {
      totalRooms: this.rooms.size,
      totalClients: totalActiveClients,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      codeEditorRooms,
      fileTreeRooms,
      gracePeriodRooms: this.gracePeriods.size,
      documentsInMemory: this.yjsManager.getDocumentList().length,
    } as ServerStatus & {
      codeEditorRooms: number;
      fileTreeRooms: number;
      gracePeriodRooms: number;
      documentsInMemory: number;
    };
  }

  forceCleanupAll(): number {
    let cleanedCount = 0;

    logger.warn('강제 정리 시작');

    this.rooms.forEach((room, roomId) => {
      const clients = Array.from(room.clients);

      clients.forEach(client => {
        try {
          if (client.readyState === 1) {
            client.close(1008, 'Force cleanup');
          }
          client.terminate();
          cleanedCount++;
        } catch (error) {
          logger.error(`강제 정리 실패: ${roomId}/${client.clientId}`, error);
        }
      });

      this.cleanupRoom(roomId);
    });

    this.gracePeriods.forEach(timeout => {
      clearTimeout(timeout);
    });
    this.gracePeriods.clear();

    logger.warn(`강제 정리 완료: ${cleanedCount}개 연결 해제`);
    return cleanedCount;
  }

  getRoomInfo(roomId: string): RoomInfo | null {
    return this.rooms.get(roomId) || null;
  }

  getAllRooms(): RoomInfo[] {
    return Array.from(this.rooms.values());
  }

  shutdown(): void {
    logger.info('룸 매니저 종료 중...');

    this.gracePeriods.forEach((timeout, roomId) => {
      clearTimeout(timeout);
      logger.debug(`Grace Period 타이머 정리: ${roomId}`);
    });
    this.gracePeriods.clear();

    this.rooms.forEach((room, roomId) => {
      room.clients.forEach(client => {
        try {
          if (client.readyState === 1) {
            client.close(1001, 'Server shutting down');
          }
        } catch (error) {
          logger.warn(`종료 중 연결 해제 실패: ${roomId}`, error);
        }
      });
    });

    this.rooms.clear();
    this.yjsManager.cleanupAllDocuments();

    logger.info('룸 매니저 종료 완료');
  }
}
