import type { WebSocket } from 'ws';

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
  apiBaseUrl?: string;
  gracePeriodMs?: number;
  enableCodeEditorFeatures?: boolean;
}

export interface ExtendedWebSocket extends WebSocket {
  roomId?: string;
  clientId?: string;
  userId?: string;
  isAlive?: boolean;
  connectedAt?: Date;
  lastActivity?: Date;
  socket?: {
    remoteAddress?: string;
  };
}

export interface RoomInfo {
  id: string;
  clients: Set<ExtendedWebSocket>;
  createdAt: Date;
  lastActivity: Date;
}

export interface ServerStatus {
  totalRooms: number;
  totalClients: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface ServerError extends Error {
  code?: string;
  statusCode?: number;
  roomId?: string;
  clientId?: string;
}

export interface ConnectionEvent {
  type: 'connect' | 'disconnect' | 'message' | 'error';
  roomId: string;
  clientId: string;
  timestamp: Date;
  data?: unknown;
}

export interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp?: number;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  rooms: number;
  clients: number;
}

export interface CodeEditorRoomInfo {
  roomId: string;
  repositoryId: number;
  filePath: string;
  clientCount: number;
  hasGracePeriod: boolean;
  lastSaved?: Date;
  contentLength: number;
}

export interface SaveApiRequest {
  filePath: string;
  content: string;
  source: 'yjs-collaboration';
}

export interface SaveApiResponse {
  success: boolean;
  message: string;
  fileId?: number;
  savedAt: string;
}
