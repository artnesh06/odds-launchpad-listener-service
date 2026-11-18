/**
 * WebSocket module exports
 */

export { WebSocketManager } from './websocket-manager';
export type {
  ConnectionState,
  RoomState,
  RoomStats,
  HealthStatus,
} from './websocket-manager';

export { RoomStrategy, roomStrategy } from './room-strategy';
export type { RoomInfo } from './room-strategy';

export { EventEmitter } from './event-emitter';
export type {
  MintEventData,
  CollectionEventData,
  PhaseEventData,
  BlockchainEvent,
} from './event-emitter';

export { ErrorLogger, errorLogger, ErrorCategory, ErrorSeverity } from './error-logger';
export type { ErrorContext, LoggedError } from './error-logger';

export { ReconnectionManager, createReconnectionManager, DEFAULT_RECONNECTION_CONFIG } from './reconnection-manager';
export type { ReconnectionConfig, ReconnectionState } from './reconnection-manager';

export { MessageValidator, messageValidator } from './message-validator';
export type { ValidationResult, MessageSchema, PropertySchema } from './message-validator';
