import type { WebSocket } from 'ws';

// 서버 설정 타입
export interface ServerConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  maxClientsPerRoom: number;
  websocketPingInterval: number;
  websocketTimeout: number;
  logLevel: string;
  logFormat: string;
  cleanupInterval: number;
}

// WebSocket 클라이언트 확장 타입
export interface ExtendedWebSocket extends WebSocket {
  roomId?: string;
  clientId?: string;
  userId?: string;
  isAlive?: boolean;
}

// 방(Room) 정보 타입
export interface RoomInfo {
  id: string;
  clients: Set<ExtendedWebSocket>;
  createdAt: Date;
  lastActivity: Date;
}

// 서버 상태 타입
export interface ServerStatus {
  totalRooms: number;
  totalClients: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

// 로그 레벨 타입
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

// 에러 타입
export interface ServerError extends Error {
  code?: string;
  statusCode?: number;
  roomId?: string;
  clientId?: string;
}

// 이벤트 타입
export interface ConnectionEvent {
  type: 'connect' | 'disconnect' | 'message' | 'error';
  roomId: string;
  clientId: string;
  timestamp: Date;
  data?: unknown;
}

// 메시지 타입
export interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp?: number;
}

// 헬스체크 응답 타입
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  rooms: number;
  clients: number;
}