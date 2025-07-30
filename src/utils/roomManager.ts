import type { ExtendedWebSocket, RoomInfo, ServerStatus } from '@/types/server.types';
import logger from '@/utils/logger';

/**
 * 방과 클라이언트를 관리하는 클래스
 */
export class RoomManager {
  private rooms: Map<string, RoomInfo> = new Map();

  /**
   * 방에 클라이언트 추가
   */
  addClient(roomId: string, client: ExtendedWebSocket): number {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        clients: new Set(),
        createdAt: new Date(),
        lastActivity: new Date(),
      });
      logger.debug(`새 방 생성: ${roomId}`);
    }

    const room = this.rooms.get(roomId)!;
    room.clients.add(client);
    room.lastActivity = new Date();

    return room.clients.size;
  }

  /**
   * 방에서 클라이언트 제거
   */
  removeClient(roomId: string, client: ExtendedWebSocket): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    room.clients.delete(client);
    room.lastActivity = new Date();

    return room.clients.size;
  }

  /**
   * 방의 모든 클라이언트에게 메시지 브로드캐스트 (발신자 제외)
   */
  broadcast(roomId: string, message: Buffer, sender: ExtendedWebSocket): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    let broadcastCount = 0;

    room.clients.forEach(client => {
      // 발신자가 아니고 연결이 활성 상태인 클라이언트에게만 전송
      if (client !== sender && client.readyState === 1) {
        try {
          client.send(message);
          broadcastCount++;
        } catch (error) {
          logger.error(`메시지 전송 실패 (${roomId}/${client.clientId})`, error);
          // 전송 실패한 클라이언트는 방에서 제거
          room.clients.delete(client);
        }
      }
    });

    // 활동 시간 업데이트
    room.lastActivity = new Date();

    return broadcastCount;
  }

  /**
   * 특정 방의 정보 조회
   */
  getRoomInfo(roomId: string): RoomInfo | null {
    return this.rooms.get(roomId) || null;
  }

  /**
   * 모든 방의 목록 조회
   */
  getAllRooms(): RoomInfo[] {
    return Array.from(this.rooms.values());
  }

  /**
   * 빈 방들 정리
   */
  cleanupEmptyRooms(): number {
    let cleanedCount = 0;

    this.rooms.forEach((room, roomId) => {
      if (room.clients.size === 0) {
        this.rooms.delete(roomId);
        cleanedCount++;
        logger.debug(`빈 방 제거: ${roomId}`);
      }
    });

    return cleanedCount;
  }

  /**
   * 비활성 클라이언트 정리
   */
  cleanupInactiveClients(): number {
    let cleanedCount = 0;

    this.rooms.forEach((room, roomId) => {
      const beforeSize = room.clients.size;

      room.clients.forEach(client => {
        // 연결이 닫혔거나 비활성 상태인 클라이언트 제거
        if (client.readyState !== 1 || !client.isAlive) {
          room.clients.delete(client);
          cleanedCount++;
          logger.debug(`비활성 클라이언트 제거 (${roomId}/${client.clientId})`);
        }
      });

      const afterSize = room.clients.size;
      if (beforeSize !== afterSize) {
        logger.roomActivity(
          roomId,
          afterSize,
          `${beforeSize - afterSize}명의 비활성 클라이언트 정리`,
        );
      }
    });

    return cleanedCount;
  }

  /**
   * 오래된 방들 정리 (마지막 활동으로부터 일정 시간 경과)
   */
  cleanupOldRooms(maxInactiveTime: number = 24 * 60 * 60 * 1000): number {
    // 기본 24시간
    let cleanedCount = 0;
    const now = new Date();

    this.rooms.forEach((room, roomId) => {
      const inactiveTime = now.getTime() - room.lastActivity.getTime();

      if (inactiveTime > maxInactiveTime) {
        // 남은 클라이언트들 강제 종료
        room.clients.forEach(client => {
          client.close(1000, 'Room closed due to inactivity');
        });

        this.rooms.delete(roomId);
        cleanedCount++;
        logger.info(
          `비활성 방 제거: ${roomId} (비활성 시간: ${Math.round(inactiveTime / 1000 / 60)}분)`,
        );
      }
    });

    return cleanedCount;
  }

  /**
   * 특정 방의 클라이언트 수 조회
   */
  getClientCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    return room ? room.clients.size : 0;
  }

  /**
   * 전체 서버 상태 조회
   */
  getServerStatus(): ServerStatus {
    const totalClients = Array.from(this.rooms.values()).reduce(
      (sum, room) => sum + room.clients.size,
      0,
    );

    return {
      totalRooms: this.rooms.size,
      totalClients,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * 방의 클라이언트 목록 조회 (디버깅용)
   */
  getClientList(roomId: string): Array<{ id: string; isAlive: boolean; readyState: number }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.clients).map(client => ({
      id: client.clientId || 'unknown',
      isAlive: client.isAlive || false,
      readyState: client.readyState,
    }));
  }

  /**
   * 모든 방과 클라이언트 정리 (서버 종료 시)
   */
  shutdown(): void {
    logger.info('룸 매니저 종료 중...');

    this.rooms.forEach((room, roomId) => {
      room.clients.forEach(client => {
        client.close(1001, 'Server shutting down');
      });
      logger.debug(`방 ${roomId} 종료: ${room.clients.size}명 연결 해제`);
    });

    this.rooms.clear();
    logger.info('모든 방과 클라이언트 정리 완료');
  }
}
