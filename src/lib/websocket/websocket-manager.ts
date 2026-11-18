/**
 * WebSocket Manager
 * 
 * Central component for managing all WebSocket operations including:
 * - Lifecycle management (initialize/shutdown)
 * - Connection pool management
 * - Room-based messaging
 * - Health monitoring and metrics
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer, createServer } from 'http';
import { WebSocketConfig } from '../../config/websocket';
import { errorLogger, ErrorCategory, ErrorSeverity } from './error-logger';
import { messageValidator } from './message-validator';
import {
  AnomalyDetector,
  DetectedAnomaly,
  CorrectiveAction,
  AnomalySeverity,
} from './anomaly-detector';
import {
  ConnectionRateLimiter,
  MessageRateLimiter,
  RateLimitConfig,
} from './rate-limiter';

/**
 * Connection state for tracking individual client connections
 */
export interface ConnectionState {
  socketId: string;
  rooms: Set<string>;
  connectedAt: Date;
  lastActivity: Date;
  reconnectAttempts: number;
  metadata: {
    userAgent?: string;
    walletAddress?: string;
    clientVersion?: string;
  };
}

/**
 * Room state for tracking room membership and activity
 */
export interface RoomState {
  name: string;
  clients: Set<string>;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  metadata: {
    type: 'homepage' | 'launchpad' | 'wallet';
    chainId?: number;
    contractAddress?: string;
  };
}

/**
 * Room statistics for monitoring
 */
export interface RoomStats {
  room: string;
  clientCount: number;
  messageCount: number;
  lastActivity: Date;
}

/**
 * Health status for the WebSocket server
 */
export interface HealthStatus {
  isHealthy: boolean;
  connectionCount: number;
  roomCount: number;
  uptime: number;
  memoryUsage: number;
}

/**
 * WebSocket Manager class
 */
export class WebSocketManager {
  private io: SocketIOServer | null = null;
  private httpServer: HTTPServer | null = null;
  private ownsHttpServer = true;
  private config: WebSocketConfig;
  
  // Connection pool: socketId -> ConnectionState
  private connections: Map<string, ConnectionState> = new Map();
  
  // Room management: roomName -> RoomState
  private rooms: Map<string, RoomState> = new Map();
  
  // Metrics tracking
  private startTime: Date | null = null;
  private totalMessagesDelivered: number = 0;
  private totalConnectionsAccepted: number = 0;
  private totalConnectionsRejected: number = 0;
  
  // Connection tracking per room
  private roomConnectionHistory: Map<string, number[]> = new Map(); // room -> [timestamp, timestamp, ...]
  
  // Message tracking
  private messageDeliveryLog: Array<{
    timestamp: Date;
    event: string;
    roomName?: string;
    recipientCount: number;
    success: boolean;
  }> = [];
  private maxLogSize: number = 1000; // Keep last 1000 message deliveries
  
  // Performance metrics
  private performanceMetrics: {
    averageMessageLatency: number;
    messagesPerSecond: number;
    peakConnectionCount: number;
    peakMessageRate: number;
    lastMetricsUpdate: Date | null;
  } = {
    averageMessageLatency: 0,
    messagesPerSecond: 0,
    peakConnectionCount: 0,
    peakMessageRate: 0,
    lastMetricsUpdate: null,
  };

  // Anomaly detection
  private anomalyDetector: AnomalyDetector;
  private anomalyCheckInterval: NodeJS.Timeout | null = null;
  private anomalyCheckIntervalMs: number = 60000; // Check every minute

  // Rate limiting
  private connectionRateLimiter: ConnectionRateLimiter;
  private messageRateLimiter: MessageRateLimiter;
  private rateLimitCleanupInterval: NodeJS.Timeout | null = null;
  private rateLimitCleanupIntervalMs: number = 300000; // Cleanup every 5 minutes

  constructor(config: WebSocketConfig) {
    this.config = config;
    this.anomalyDetector = new AnomalyDetector();
    this.connectionRateLimiter = new ConnectionRateLimiter(config.rateLimit);
    this.messageRateLimiter = new MessageRateLimiter(config.rateLimit);
  }

  /**
   * Initialize the WebSocket server
   */
  /**
   * @param existingServer attach Socket.IO to this HTTP server (same port as the API)
   *        instead of listening on a separate port
   */
  async initialize(port?: number, existingServer?: HTTPServer): Promise<void> {
    const serverPort = port || this.config.port;

    if (this.io) {
      const error = new Error('WebSocket Manager already initialized');
      errorLogger.logResourceError(
        'Attempted to initialize already initialized WebSocket Manager',
        ErrorSeverity.ERROR,
        error
      );
      throw error;
    }

    try {
      // Create (or reuse) the HTTP server for Socket.IO
      this.ownsHttpServer = !existingServer;
      this.httpServer = existingServer ?? createServer();

      // Initialize Socket.IO server with permissive CORS (we'll validate in middleware)
      this.io = new SocketIOServer(this.httpServer, {
        cors: {
          origin: '*', // Allow all origins, we'll validate in middleware
          methods: ['GET', 'POST'],
          credentials: true,
        },
        maxHttpBufferSize: this.config.messageSizeLimit,
        pingInterval: this.config.pingInterval,
        pingTimeout: this.config.pingTimeout,
        transports: ['websocket', 'polling'],
        allowEIO3: true,
      });

      // Set up middleware for origin validation and rate limiting (runs before connection)
      this.io.use((socket, next) => {
        const origin = socket.handshake.headers.origin;
        const referer = socket.handshake.headers.referer;
        const allowedOrigins = Array.isArray(this.config.corsOrigin)
          ? this.config.corsOrigin
          : [this.config.corsOrigin];

        // Check connection rate limit first (if enabled)
        if (this.config.rateLimitEnabled) {
          const ip = this.getClientIP(socket);
          const rateLimitResult = this.connectionRateLimiter.checkConnection(ip);

          if (!rateLimitResult.allowed) {
            errorLogger.logError(
              'Connection rate limit exceeded',
              ErrorCategory.CONNECTION,
              ErrorSeverity.WARN,
              undefined,
              {
                socketId: socket.id,
                origin: ip,
                additionalData: { retryAfter: rateLimitResult.retryAfter },
              }
            );
            this.log('warn', `Connection rate limit exceeded for IP ${ip}, rejecting connection ${socket.id}`);
            this.totalConnectionsRejected++;
            
            const error = new Error('Too many connection attempts. Please try again later.');
            (error as any).data = {
              retryAfter: rateLimitResult.retryAfter,
              resetAt: rateLimitResult.resetAt.toISOString(),
            };
            return next(error);
          }
        }

        // Check if origin is provided and valid
        if (origin) {
          const isAllowed = allowedOrigins.some((allowed) => {
            if (allowed === '*') return true;
            if (allowed.endsWith('*')) {
              const prefix = allowed.slice(0, -1);
              return origin.startsWith(prefix);
            }
            return origin === allowed;
          });

          if (!isAllowed) {
            errorLogger.logAuthenticationError(
              'Unauthorized origin, rejecting connection',
              socket.id,
              origin
            );
            this.log('warn', `Unauthorized origin ${origin}, rejecting connection ${socket.id}`);
            this.totalConnectionsRejected++;
            return next(new Error('Connection not allowed from this location'));
          }
        } else if (referer) {
          try {
            const refererUrl = new URL(referer);
            const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
            
            const isAllowed = allowedOrigins.some((allowed) => {
              if (allowed === '*') return true;
              if (allowed.endsWith('*')) {
                const prefix = allowed.slice(0, -1);
                return refererOrigin.startsWith(prefix);
              }
              return refererOrigin === allowed;
            });

            if (!isAllowed) {
              errorLogger.logAuthenticationError(
                'Unauthorized referer, rejecting connection',
                socket.id,
                refererOrigin
              );
              this.log('warn', `Unauthorized referer ${refererOrigin}, rejecting connection ${socket.id}`);
              this.totalConnectionsRejected++;
              return next(new Error('Connection not allowed from this location'));
            }
          } catch (error) {
            errorLogger.logAuthenticationError(
              'Invalid referer URL, rejecting connection',
              socket.id,
              referer
            );
            this.log('warn', `Invalid referer ${referer}, rejecting connection ${socket.id}`);
            this.totalConnectionsRejected++;
            return next(new Error('Connection not allowed from this location'));
          }
        } else if (!allowedOrigins.includes('*')) {
          errorLogger.logAuthenticationError(
            'Missing origin/referer header, rejecting connection',
            socket.id,
            'none'
          );
          this.log('warn', `Missing origin/referer header, rejecting connection ${socket.id}`);
          this.totalConnectionsRejected++;
          return next(new Error('Connection not allowed from this location'));
        }

        // Origin is valid, proceed
        next();
      });

      // Set up connection handler
      this.io.on('connection', (socket: Socket) => {
        this.handleConnection(socket);
      });

      // Start HTTP server (only when we own it)
      if (!this.ownsHttpServer) {
        this.startTime = new Date();
        this.log('info', 'WebSocket server attached to the API HTTP server');
      } else await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(serverPort, () => {
          this.startTime = new Date();
          this.log('info', `WebSocket server initialized on port ${serverPort}`);
          resolve();
        });

        this.httpServer!.on('error', (error) => {
          errorLogger.logResourceError(
            `Failed to start WebSocket server on port ${serverPort}`,
            ErrorSeverity.CRITICAL,
            error,
            { port: serverPort }
          );
          this.log('error', `Failed to start WebSocket server: ${error.message}`);
          reject(error);
        });
      });

      // Start anomaly detection
      this.startAnomalyDetection();

      // Start rate limit cleanup
      if (this.config.rateLimitEnabled) {
        this.startRateLimitCleanup();
      }

      this.log('info', 'WebSocket Manager initialized successfully');
    } catch (error) {
      errorLogger.logResourceError(
        'WebSocket Manager initialization failed',
        ErrorSeverity.CRITICAL,
        error as Error
      );
      this.log('error', `WebSocket Manager initialization failed: ${error}`);
      throw error;
    }
  }

  /**
   * Shutdown the WebSocket server gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.io) {
      this.log('warn', 'WebSocket Manager not initialized, nothing to shutdown');
      return;
    }

    try {
      this.log('info', 'Shutting down WebSocket Manager...');

      // Stop anomaly detection
      this.stopAnomalyDetection();

      // Stop rate limit cleanup
      this.stopRateLimitCleanup();

      // Disconnect all clients
      const sockets = await this.io.fetchSockets();
      for (const socket of sockets) {
        socket.disconnect(true);
      }

      // Close Socket.IO server
      await new Promise<void>((resolve) => {
        this.io!.close(() => {
          this.log('info', 'Socket.IO server closed');
          resolve();
        });
      });

      // Close HTTP server (the shared API server is closed by its owner)
      if (this.httpServer && this.ownsHttpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => {
            this.log('info', 'HTTP server closed');
            resolve();
          });
        });
      }

      // Clear all data structures
      this.connections.clear();
      this.rooms.clear();
      this.roomConnectionHistory.clear();
      this.messageDeliveryLog = [];
      this.io = null;
      this.httpServer = null;
      this.startTime = null;
      
      // Reset metrics
      this.totalMessagesDelivered = 0;
      this.totalConnectionsAccepted = 0;
      this.totalConnectionsRejected = 0;
      this.performanceMetrics = {
        averageMessageLatency: 0,
        messagesPerSecond: 0,
        peakConnectionCount: 0,
        peakMessageRate: 0,
        lastMetricsUpdate: null,
      };

      this.log('info', 'WebSocket Manager shutdown complete');
    } catch (error) {
      errorLogger.logResourceError(
        'Error during WebSocket Manager shutdown',
        ErrorSeverity.ERROR,
        error as Error
      );
      this.log('error', `Error during shutdown: ${error}`);
      throw error;
    }
  }

  /**
   * Handle new client connection
   */
  handleConnection(socket: Socket): void {
    const socketId = socket.id;
    const origin = socket.handshake.headers.origin;
    const referer = socket.handshake.headers.referer;

    // Check connection limit
    if (this.connections.size >= this.config.maxConnections) {
      errorLogger.logConnectionError(
        'Connection limit reached, rejecting connection',
        socketId,
        origin || referer
      );
      this.log('warn', `Connection limit reached, rejecting connection ${socketId}`);
      this.totalConnectionsRejected++;
      socket.emit('error', {
        message: errorLogger.getErrorHistory(ErrorCategory.CONNECTION, undefined, 1)[0]
          ?.userFriendlyMessage || 'Server is at capacity',
      });
      socket.disconnect(true);
      return;
    }

    // Create connection state
    const connectionState: ConnectionState = {
      socketId,
      rooms: new Set(),
      connectedAt: new Date(),
      lastActivity: new Date(),
      reconnectAttempts: 0,
      metadata: {
        userAgent: socket.handshake.headers['user-agent'],
        clientVersion: socket.handshake.query.clientVersion as string,
      },
    };

    this.connections.set(socketId, connectionState);
    this.totalConnectionsAccepted++;

    this.log('info', `Client connected: ${socketId} (total: ${this.connections.size})`);

    // Set up event handlers
    socket.on('disconnect', () => {
      this.handleDisconnection(socketId);
    });

    socket.on('join', (data: { room: string; walletAddress?: string }) => {
      // Check message rate limit
      if (this.config.rateLimitEnabled) {
        const rateLimitResult = this.messageRateLimiter.checkMessage(socketId);
        if (!rateLimitResult.allowed) {
          errorLogger.logMessageError(
            'Message rate limit exceeded',
            socketId,
            'join',
            undefined,
            { retryAfter: rateLimitResult.retryAfter }
          );
          socket.emit('error', {
            message: 'Too many messages. Please slow down.',
            retryAfter: rateLimitResult.retryAfter,
            resetAt: rateLimitResult.resetAt.toISOString(),
          });
          return;
        }

        // Check backpressure
        const backpressure = this.messageRateLimiter.checkBackpressure(socketId);
        if (backpressure.active) {
          this.log('debug', `Backpressure active for ${socketId}: ${backpressure.reason}`);
          // Apply delay before processing
          setTimeout(() => {
            this.processJoinMessage(socket, socketId, data, connectionState);
          }, backpressure.delayMs);
          return;
        }
      }

      this.processJoinMessage(socket, socketId, data, connectionState);
    });

    socket.on('leave', (data: { room: string }) => {
      // Check message rate limit
      if (this.config.rateLimitEnabled) {
        const rateLimitResult = this.messageRateLimiter.checkMessage(socketId);
        if (!rateLimitResult.allowed) {
          errorLogger.logMessageError(
            'Message rate limit exceeded',
            socketId,
            'leave',
            undefined,
            { retryAfter: rateLimitResult.retryAfter }
          );
          socket.emit('error', {
            message: 'Too many messages. Please slow down.',
            retryAfter: rateLimitResult.retryAfter,
            resetAt: rateLimitResult.resetAt.toISOString(),
          });
          return;
        }

        // Check backpressure
        const backpressure = this.messageRateLimiter.checkBackpressure(socketId);
        if (backpressure.active) {
          this.log('debug', `Backpressure active for ${socketId}: ${backpressure.reason}`);
          // Apply delay before processing
          setTimeout(() => {
            this.processLeaveMessage(socket, socketId, data);
          }, backpressure.delayMs);
          return;
        }
      }

      this.processLeaveMessage(socket, socketId, data);
    });

    socket.on('ping', (data?: { timestamp?: string }) => {
      // Check message rate limit
      if (this.config.rateLimitEnabled) {
        const rateLimitResult = this.messageRateLimiter.checkMessage(socketId);
        if (!rateLimitResult.allowed) {
          // Don't send error for ping, just ignore
          return;
        }
      }

      // Validate message if data is provided
      if (data) {
        const validation = messageValidator.validateClientMessage('ping', data, socketId);
        if (!validation.isValid) {
          errorLogger.logValidationError(
            'Invalid ping message',
            socketId,
            'ping',
            undefined,
            { errors: validation.errors }
          );
          return;
        }
      }

      connectionState.lastActivity = new Date();
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Emit connection ready event
    socket.emit('ready', {
      socketId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Process join message (extracted for rate limiting)
   */
  private processJoinMessage(
    socket: Socket,
    socketId: string,
    data: { room: string; walletAddress?: string },
    connectionState: ConnectionState
  ): void {
    // Validate message
    const validation = messageValidator.validateClientMessage('join', data, socketId);
    if (!validation.isValid) {
      errorLogger.logValidationError(
        'Invalid join message',
        socketId,
        'join',
        undefined,
        { errors: validation.errors }
      );
      socket.emit('error', {
        message: 'Invalid join message',
        errors: validation.errors,
      });
      return;
    }

    if (data.walletAddress) {
      connectionState.metadata.walletAddress = data.walletAddress;
    }
    this.joinRoom(socketId, data.room);
  }

  /**
   * Process leave message (extracted for rate limiting)
   */
  private processLeaveMessage(
    socket: Socket,
    socketId: string,
    data: { room: string }
  ): void {
    // Validate message
    const validation = messageValidator.validateClientMessage('leave', data, socketId);
    if (!validation.isValid) {
      errorLogger.logValidationError(
        'Invalid leave message',
        socketId,
        'leave',
        undefined,
        { errors: validation.errors }
      );
      socket.emit('error', {
        message: 'Invalid leave message',
        errors: validation.errors,
      });
      return;
    }

    this.leaveRoom(socketId, data.room);
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(socketId: string): void {
    const connectionState = this.connections.get(socketId);

    if (!connectionState) {
      errorLogger.logConnectionError(
        'Disconnection for unknown socket',
        socketId
      );
      this.log('warn', `Disconnection for unknown socket: ${socketId}`);
      return;
    }

    // Remove client from all rooms
    for (const roomName of connectionState.rooms) {
      const room = this.rooms.get(roomName);
      if (room) {
        room.clients.delete(socketId);

        // Clean up empty rooms
        if (room.clients.size === 0) {
          this.rooms.delete(roomName);
          this.log('debug', `Room ${roomName} deleted (empty)`);
        }
      }
    }

    // Clean up rate limiter history for this connection
    if (this.config.rateLimitEnabled) {
      this.messageRateLimiter.clearMessageHistory(socketId);
    }

    // Remove connection state
    this.connections.delete(socketId);

    this.log('info', `Client disconnected: ${socketId} (total: ${this.connections.size})`);
  }

  /**
   * Add a client to a room
   */
  joinRoom(socketId: string, roomName: string): void {
    const connectionState = this.connections.get(socketId);

    if (!connectionState) {
      errorLogger.logRoomError(
        'Cannot join room: unknown socket',
        roomName,
        socketId
      );
      this.log('warn', `Cannot join room: unknown socket ${socketId}`);
      return;
    }

    // Get or create room
    let room = this.rooms.get(roomName);
    if (!room) {
      room = {
        name: roomName,
        clients: new Set(),
        createdAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        metadata: this.parseRoomMetadata(roomName),
      };
      this.rooms.set(roomName, room);
      this.log('debug', `Room created: ${roomName}`);
    }

    // Add client to room
    room.clients.add(socketId);
    connectionState.rooms.add(roomName);

    // Join Socket.IO room
    const socket = this.io?.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(roomName);
      
      // Emit confirmation to client
      socket.emit('joined', { room: roomName, clientCount: room.clients.size });
    }

    // Track connection to room
    this.trackRoomConnection(roomName);

    this.log('info', `Client ${socketId} joined room ${roomName} (${room.clients.size} clients)`);
  }

  /**
   * Remove a client from a room
   */
  leaveRoom(socketId: string, roomName: string): void {
    const connectionState = this.connections.get(socketId);
    const room = this.rooms.get(roomName);

    if (!connectionState) {
      errorLogger.logRoomError(
        'Cannot leave room: unknown socket',
        roomName,
        socketId
      );
      this.log('warn', `Cannot leave room: unknown socket ${socketId}`);
      return;
    }

    if (!room) {
      errorLogger.logRoomError(
        'Cannot leave room: unknown room',
        roomName,
        socketId
      );
      this.log('warn', `Cannot leave room: unknown room ${roomName}`);
      return;
    }

    // Remove client from room
    room.clients.delete(socketId);
    connectionState.rooms.delete(roomName);

    // Leave Socket.IO room
    const socket = this.io?.sockets.sockets.get(socketId);
    if (socket) {
      socket.leave(roomName);
      
      // Emit confirmation to client
      socket.emit('left', { room: roomName });
    }

    // Clean up empty rooms
    if (room.clients.size === 0) {
      this.rooms.delete(roomName);
      this.log('debug', `Room ${roomName} deleted (empty)`);
    }

    this.log('info', `Client ${socketId} left room ${roomName}`);
  }

  /**
   * Get all clients in a room
   */
  getRoomClients(roomName: string): string[] {
    const room = this.rooms.get(roomName);
    return room ? Array.from(room.clients) : [];
  }

  /**
   * Broadcast event to all clients in a room
   */
  broadcastToRoom(roomName: string, event: string, data: any): void {
    const startTime = Date.now();
    
    if (!this.io) {
      errorLogger.logMessageError(
        'Cannot broadcast: WebSocket Manager not initialized',
        undefined,
        event
      );
      this.log('warn', 'Cannot broadcast: WebSocket Manager not initialized');
      this.logMessageDelivery(event, roomName, 0, false);
      return;
    }

    const room = this.rooms.get(roomName);
    if (!room) {
      this.log('debug', `Cannot broadcast to room ${roomName}: room does not exist`);
      this.logMessageDelivery(event, roomName, 0, false);
      return;
    }

    // Validate message size
    const sizeValidation = messageValidator.validateMessageSize(
      data,
      this.config.messageSizeLimit
    );
    if (!sizeValidation.isValid) {
      errorLogger.logValidationError(
        'Message size exceeds limit',
        undefined,
        event,
        undefined,
        { roomName, errors: sizeValidation.errors }
      );
      this.logMessageDelivery(event, roomName, 0, false);
      return;
    }

    // Validate event data if it's a known event type
    const validation = messageValidator.validateServerEvent(event, data);
    if (!validation.isValid) {
      errorLogger.logValidationError(
        'Invalid event data',
        undefined,
        event,
        undefined,
        { roomName, errors: validation.errors }
      );
      // Still broadcast for unknown event types, but log the validation error
      if (event in messageValidator['validateServerEvent']) {
        this.logMessageDelivery(event, roomName, 0, false);
        return;
      }
    }

    // Update room activity
    room.lastActivity = new Date();
    room.messageCount++;

    // Broadcast to room
    const recipientCount = room.clients.size;
    this.io.to(roomName).emit(event, data);

    // Update metrics
    this.totalMessagesDelivered += recipientCount;
    
    // Log message delivery
    this.logMessageDelivery(event, roomName, recipientCount, true);
    
    // Update performance metrics
    const latency = Date.now() - startTime;
    this.updatePerformanceMetrics(latency);

    this.log('debug', `Broadcast to room ${roomName}: ${event} (${recipientCount} clients, ${latency}ms)`);
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcastToAll(event: string, data: any): void {
    const startTime = Date.now();
    
    if (!this.io) {
      errorLogger.logMessageError(
        'Cannot broadcast: WebSocket Manager not initialized',
        undefined,
        event
      );
      this.log('warn', 'Cannot broadcast: WebSocket Manager not initialized');
      this.logMessageDelivery(event, undefined, 0, false);
      return;
    }

    // Validate message size
    const sizeValidation = messageValidator.validateMessageSize(
      data,
      this.config.messageSizeLimit
    );
    if (!sizeValidation.isValid) {
      errorLogger.logValidationError(
        'Message size exceeds limit',
        undefined,
        event,
        undefined,
        { errors: sizeValidation.errors }
      );
      this.logMessageDelivery(event, undefined, 0, false);
      return;
    }

    // Validate event data if it's a known event type
    const validation = messageValidator.validateServerEvent(event, data);
    if (!validation.isValid) {
      errorLogger.logValidationError(
        'Invalid event data',
        undefined,
        event,
        undefined,
        { errors: validation.errors }
      );
      // Still broadcast for unknown event types, but log the validation error
      if (event in messageValidator['validateServerEvent']) {
        this.logMessageDelivery(event, undefined, 0, false);
        return;
      }
    }

    const recipientCount = this.connections.size;
    this.io.emit(event, data);

    // Update metrics
    this.totalMessagesDelivered += recipientCount;
    
    // Log message delivery
    this.logMessageDelivery(event, undefined, recipientCount, true);
    
    // Update performance metrics
    const latency = Date.now() - startTime;
    this.updatePerformanceMetrics(latency);

    this.log('debug', `Broadcast to all: ${event} (${recipientCount} clients, ${latency}ms)`);
  }

  /**
   * Broadcast multiple events in batch to optimize performance
   * Batches events within a time window to reduce network overhead
   */
  broadcastBatch(events: Array<{ room: string; event: string; data: any }>): void {
    if (!this.io) {
      errorLogger.logMessageError(
        'Cannot broadcast batch: WebSocket Manager not initialized',
        undefined,
        'batch'
      );
      return;
    }

    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    // Group events by room for efficient broadcasting
    const eventsByRoom = new Map<string, Array<{ event: string; data: any }>>();
    
    for (const item of events) {
      if (!eventsByRoom.has(item.room)) {
        eventsByRoom.set(item.room, []);
      }
      eventsByRoom.get(item.room)!.push({ event: item.event, data: item.data });
    }

    // Broadcast to each room
    for (const [roomName, roomEvents] of eventsByRoom.entries()) {
      const room = this.rooms.get(roomName);
      if (!room) {
        failCount += roomEvents.length;
        continue;
      }

      // Send all events to the room
      for (const { event, data } of roomEvents) {
        // Validate message
        const validation = messageValidator.validateServerEvent(event, data);
        if (!validation.isValid) {
          failCount++;
          continue;
        }

        // Broadcast
        this.io.to(roomName).emit(event, data);
        successCount++;
        
        // Update room metrics
        room.lastActivity = new Date();
        room.messageCount++;
      }
    }

    // Update metrics
    this.totalMessagesDelivered += successCount;
    
    const latency = Date.now() - startTime;
    this.updatePerformanceMetrics(latency);

    this.log('debug', `Batch broadcast: ${successCount} success, ${failCount} failed (${latency}ms)`);
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get room statistics
   */
  getRoomStats(): RoomStats[] {
    return Array.from(this.rooms.values()).map((room) => ({
      room: room.name,
      clientCount: room.clients.size,
      messageCount: room.messageCount,
      lastActivity: room.lastActivity,
    }));
  }

  /**
   * Get health status
   */
  getHealthStatus(): HealthStatus {
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    const memoryUsage = process.memoryUsage().heapUsed;

    return {
      isHealthy: this.io !== null && this.httpServer !== null,
      connectionCount: this.connections.size,
      roomCount: this.rooms.size,
      uptime,
      memoryUsage,
    };
  }

  /**
   * Track a connection to a room
   */
  private trackRoomConnection(roomName: string): void {
    const history = this.roomConnectionHistory.get(roomName) || [];
    history.push(Date.now());
    
    // Keep only last 1000 connections per room
    if (history.length > 1000) {
      history.shift();
    }
    
    this.roomConnectionHistory.set(roomName, history);
    
    // Update peak connection count
    const currentCount = this.connections.size;
    if (currentCount > this.performanceMetrics.peakConnectionCount) {
      this.performanceMetrics.peakConnectionCount = currentCount;
    }
  }

  /**
   * Log message delivery
   */
  private logMessageDelivery(
    event: string,
    roomName: string | undefined,
    recipientCount: number,
    success: boolean
  ): void {
    this.messageDeliveryLog.push({
      timestamp: new Date(),
      event,
      roomName,
      recipientCount,
      success,
    });

    // Keep log size under limit
    if (this.messageDeliveryLog.length > this.maxLogSize) {
      this.messageDeliveryLog.shift();
    }

    // Log to console for monitoring
    if (success) {
      this.log(
        'info',
        `Message delivered: ${event} to ${roomName || 'all'} (${recipientCount} recipients)`
      );
    } else {
      this.log(
        'warn',
        `Message delivery failed: ${event} to ${roomName || 'all'}`
      );
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(latency: number): void {
    // Update average latency (exponential moving average)
    const alpha = 0.1; // Smoothing factor
    this.performanceMetrics.averageMessageLatency =
      alpha * latency + (1 - alpha) * this.performanceMetrics.averageMessageLatency;

    // Calculate messages per second
    const now = Date.now();
    const lastUpdate = this.performanceMetrics.lastMetricsUpdate?.getTime() || now;
    const timeDiff = (now - lastUpdate) / 1000; // Convert to seconds

    if (timeDiff > 0) {
      const recentMessages = this.messageDeliveryLog.filter(
        (log) => log.timestamp.getTime() > lastUpdate
      ).length;

      const currentRate = recentMessages / timeDiff;
      this.performanceMetrics.messagesPerSecond = currentRate;

      // Update peak message rate
      if (currentRate > this.performanceMetrics.peakMessageRate) {
        this.performanceMetrics.peakMessageRate = currentRate;
      }
    }

    this.performanceMetrics.lastMetricsUpdate = new Date();
  }

  /**
   * Get connection tracking data for a specific room
   */
  getConnectionsPerRoom(roomName: string): number {
    const room = this.rooms.get(roomName);
    return room ? room.clients.size : 0;
  }

  /**
   * Get all active connections per room
   */
  getAllConnectionsPerRoom(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [roomName, room] of this.rooms.entries()) {
      result.set(roomName, room.clients.size);
    }
    return result;
  }

  /**
   * Get message delivery statistics
   */
  getMessageDeliveryStats(): {
    totalDelivered: number;
    successRate: number;
    averageRecipients: number;
    recentDeliveries: Array<{
      timestamp: Date;
      event: string;
      roomName?: string;
      recipientCount: number;
      success: boolean;
    }>;
  } {
    const successfulDeliveries = this.messageDeliveryLog.filter((log) => log.success).length;
    const totalAttempts = this.messageDeliveryLog.length;
    const successRate = totalAttempts > 0 ? successfulDeliveries / totalAttempts : 1;

    const totalRecipients = this.messageDeliveryLog.reduce(
      (sum, log) => sum + log.recipientCount,
      0
    );
    const averageRecipients = totalAttempts > 0 ? totalRecipients / totalAttempts : 0;

    return {
      totalDelivered: this.totalMessagesDelivered,
      successRate,
      averageRecipients,
      recentDeliveries: this.messageDeliveryLog.slice(-100), // Last 100 deliveries
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): typeof this.performanceMetrics & {
    totalMessagesDelivered: number;
    totalConnectionsAccepted: number;
    totalConnectionsRejected: number;
  } {
    return {
      ...this.performanceMetrics,
      totalMessagesDelivered: this.totalMessagesDelivered,
      totalConnectionsAccepted: this.totalConnectionsAccepted,
      totalConnectionsRejected: this.totalConnectionsRejected,
    };
  }

  /**
   * Get room connection history
   */
  getRoomConnectionHistory(roomName: string): number[] {
    return this.roomConnectionHistory.get(roomName) || [];
  }

  /**
   * Parse room metadata from room name
   */
  private parseRoomMetadata(roomName: string): RoomState['metadata'] {
    // homepage:all or homepage:chain:123
    if (roomName.startsWith('homepage:')) {
      const parts = roomName.split(':');
      if (parts[1] === 'all') {
        return { type: 'homepage' };
      } else if (parts[1] === 'chain' && parts[2]) {
        return { type: 'homepage', chainId: parseInt(parts[2], 10) };
      }
    }

    // launchpad:0x123...
    if (roomName.startsWith('launchpad:')) {
      const contractAddress = roomName.substring('launchpad:'.length);
      return { type: 'launchpad', contractAddress };
    }

    // wallet:0x123...
    if (roomName.startsWith('wallet:')) {
      return { type: 'wallet' };
    }

    // Default
    return { type: 'homepage' };
  }

  /**
   * Log message with configured log level
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const messageLevel = levels.indexOf(level);

    if (messageLevel >= configLevel) {
      const timestamp = new Date().toISOString();
      const prefix = level.toUpperCase().padEnd(5);
      console.log(`[${timestamp}] [WS-${prefix}] ${message}`);
    }
  }

  /**
   * Start anomaly detection
   */
  private startAnomalyDetection(): void {
    if (this.anomalyCheckInterval) {
      this.log('warn', 'Anomaly detection already running');
      return;
    }

    this.log('info', 'Starting anomaly detection');

    this.anomalyCheckInterval = setInterval(() => {
      this.performAnomalyCheck();
    }, this.anomalyCheckIntervalMs);
  }

  /**
   * Stop anomaly detection
   */
  private stopAnomalyDetection(): void {
    if (this.anomalyCheckInterval) {
      clearInterval(this.anomalyCheckInterval);
      this.anomalyCheckInterval = null;
      this.log('info', 'Anomaly detection stopped');
    }
  }

  /**
   * Perform anomaly check
   */
  private performAnomalyCheck(): void {
    try {
      // Gather metrics
      const memoryUsage = process.memoryUsage().heapUsed;
      const connectionCount = this.connections.size;
      const errorStats = errorLogger.getErrorStats();
      const errorCount = errorStats.total;
      const messageStats = this.getMessageDeliveryStats();
      const messageRate = this.performanceMetrics.messagesPerSecond;

      // Get connection activity data
      const connections = Array.from(this.connections.values()).map((conn) => ({
        socketId: conn.socketId,
        lastActivity: conn.lastActivity,
      }));

      // Check for anomalies
      const anomalies = this.anomalyDetector.checkForAnomalies({
        memoryUsage,
        connectionCount,
        maxConnections: this.config.maxConnections,
        errorCount,
        messageRate,
        connections,
      });

      // Handle detected anomalies
      if (anomalies.length > 0) {
        this.log('warn', `Detected ${anomalies.length} anomalies`);

        for (const anomaly of anomalies) {
          this.handleAnomaly(anomaly);
        }
      }
    } catch (error) {
      errorLogger.logResourceError(
        'Error during anomaly check',
        ErrorSeverity.ERROR,
        error as Error
      );
      this.log('error', `Error during anomaly check: ${error}`);
    }
  }

  /**
   * Handle detected anomaly
   */
  private handleAnomaly(anomaly: DetectedAnomaly): void {
    // Log the anomaly
    this.log('warn', `Anomaly: ${anomaly.message}`);

    // Execute corrective actions
    for (const action of anomaly.suggestedActions) {
      this.executeCorrectiveAction(action, anomaly);
    }

    // Emit warning to monitoring systems
    if (anomaly.severity === AnomalySeverity.HIGH || anomaly.severity === AnomalySeverity.CRITICAL) {
      this.emitAnomalyWarning(anomaly);
    }
  }

  /**
   * Execute corrective action
   */
  private executeCorrectiveAction(action: string, anomaly: DetectedAnomaly): void {
    this.log('info', `Executing corrective action: ${action}`);

    switch (action) {
      case CorrectiveAction.CLEANUP_STALE_CONNECTIONS:
        this.cleanupStaleConnections();
        break;

      case CorrectiveAction.FORCE_GARBAGE_COLLECTION:
        this.forceGarbageCollection();
        break;

      case CorrectiveAction.THROTTLE_CONNECTIONS:
        this.log('warn', 'Connection throttling recommended - consider implementing rate limiting');
        break;

      case CorrectiveAction.THROTTLE_MESSAGES:
        this.log('warn', 'Message throttling recommended - consider implementing rate limiting');
        break;

      case CorrectiveAction.CLOSE_IDLE_CONNECTIONS:
        this.closeIdleConnections();
        break;

      case CorrectiveAction.CLEAR_MESSAGE_HISTORY:
        this.clearMessageHistory();
        break;

      case CorrectiveAction.EMIT_WARNING:
        // Already handled by emitAnomalyWarning
        break;

      default:
        this.log('warn', `Unknown corrective action: ${action}`);
    }
  }

  /**
   * Cleanup stale connections
   */
  private cleanupStaleConnections(): void {
    const now = new Date();
    const staleThresholdMs = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;

    for (const [socketId, conn] of this.connections.entries()) {
      const inactiveTime = now.getTime() - conn.lastActivity.getTime();

      if (inactiveTime > staleThresholdMs) {
        const socket = this.io?.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.log('info', `Cleaned up ${cleanedCount} stale connections`);
    }
  }

  /**
   * Force garbage collection (if available)
   */
  private forceGarbageCollection(): void {
    if (global.gc) {
      this.log('info', 'Forcing garbage collection');
      global.gc();
    } else {
      this.log('warn', 'Garbage collection not available (run with --expose-gc flag)');
    }
  }

  /**
   * Close idle connections
   */
  private closeIdleConnections(): void {
    const now = new Date();
    const idleThresholdMs = 10 * 60 * 1000; // 10 minutes
    let closedCount = 0;

    // Sort connections by last activity
    const sortedConnections = Array.from(this.connections.entries()).sort(
      ([, a], [, b]) => a.lastActivity.getTime() - b.lastActivity.getTime()
    );

    // Close oldest 10% of connections if they're idle
    const closeCount = Math.ceil(sortedConnections.length * 0.1);

    for (let i = 0; i < closeCount && i < sortedConnections.length; i++) {
      const [socketId, conn] = sortedConnections[i];
      const inactiveTime = now.getTime() - conn.lastActivity.getTime();

      if (inactiveTime > idleThresholdMs) {
        const socket = this.io?.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
          closedCount++;
        }
      }
    }

    if (closedCount > 0) {
      this.log('info', `Closed ${closedCount} idle connections`);
    }
  }

  /**
   * Clear message history
   */
  private clearMessageHistory(): void {
    const beforeSize = this.messageDeliveryLog.length;
    this.messageDeliveryLog = this.messageDeliveryLog.slice(-100); // Keep only last 100
    const clearedCount = beforeSize - this.messageDeliveryLog.length;

    if (clearedCount > 0) {
      this.log('info', `Cleared ${clearedCount} message history entries`);
    }
  }

  /**
   * Emit anomaly warning
   */
  private emitAnomalyWarning(anomaly: DetectedAnomaly): void {
    // Broadcast warning to all connected clients (optional)
    // This could be used by admin dashboards or monitoring tools
    if (this.io) {
      this.io.emit('system:anomaly', {
        type: anomaly.type,
        severity: anomaly.severity,
        message: anomaly.message,
        timestamp: anomaly.timestamp.toISOString(),
      });
    }

    this.log('warn', `Anomaly warning emitted: ${anomaly.type} - ${anomaly.message}`);
  }

  /**
   * Get anomaly detection statistics
   */
  getAnomalyStats(): {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    recentAnomalies: DetectedAnomaly[];
  } {
    return {
      ...this.anomalyDetector.getAnomalyStats(),
      recentAnomalies: this.anomalyDetector.getDetectedAnomalies(undefined, undefined, 10),
    };
  }

  /**
   * Get anomaly detector instance (for testing)
   */
  getAnomalyDetector(): AnomalyDetector {
    return this.anomalyDetector;
  }

  /**
   * Get rejected connection statistics
   */
  getRejectedConnectionStats(): {
    total: number;
    recentRejections: Array<{
      socketId: string;
      origin?: string;
      reason: string;
      timestamp: Date;
    }>;
  } {
    // Get authentication errors from error logger (these are origin rejections)
    const authErrors = errorLogger.getErrorHistory(ErrorCategory.AUTHENTICATION);
    
    const recentRejections = authErrors
      .filter((error) => 
        error.message.includes('Unauthorized origin') || 
        error.message.includes('Unauthorized referer') ||
        error.message.includes('Missing origin/referer')
      )
      .slice(-50) // Last 50 rejections
      .map((error) => ({
        socketId: error.context.socketId || 'unknown',
        origin: error.context.origin,
        reason: error.message,
        timestamp: error.context.timestamp,
      }));

    return {
      total: this.totalConnectionsRejected,
      recentRejections,
    };
  }

  /**
   * Get client IP address from socket
   */
  private getClientIP(socket: Socket): string {
    // Try to get real IP from headers (for proxied connections)
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      return ips.split(',')[0].trim();
    }

    const realIP = socket.handshake.headers['x-real-ip'];
    if (realIP) {
      return Array.isArray(realIP) ? realIP[0] : realIP;
    }

    // Fallback to socket address
    return socket.handshake.address || 'unknown';
  }

  /**
   * Start rate limit cleanup
   */
  private startRateLimitCleanup(): void {
    if (this.rateLimitCleanupInterval) {
      this.log('warn', 'Rate limit cleanup already running');
      return;
    }

    this.log('info', 'Starting rate limit cleanup');

    this.rateLimitCleanupInterval = setInterval(() => {
      this.performRateLimitCleanup();
    }, this.rateLimitCleanupIntervalMs);
  }

  /**
   * Stop rate limit cleanup
   */
  private stopRateLimitCleanup(): void {
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      this.rateLimitCleanupInterval = null;
      this.log('info', 'Rate limit cleanup stopped');
    }
  }

  /**
   * Perform rate limit cleanup
   */
  private performRateLimitCleanup(): void {
    try {
      this.log('debug', 'Performing rate limit cleanup');
      this.connectionRateLimiter.cleanup();
      this.messageRateLimiter.cleanup();
    } catch (error) {
      errorLogger.logResourceError(
        'Error during rate limit cleanup',
        ErrorSeverity.ERROR,
        error as Error
      );
      this.log('error', `Error during rate limit cleanup: ${error}`);
    }
  }

  /**
   * Get rate limit statistics
   */
  getRateLimitStats(): {
    connectionRateLimit: {
      enabled: boolean;
      config: RateLimitConfig;
    };
    messageRateLimit: {
      enabled: boolean;
      config: RateLimitConfig;
    };
  } {
    return {
      connectionRateLimit: {
        enabled: this.config.rateLimitEnabled,
        config: this.config.rateLimit,
      },
      messageRateLimit: {
        enabled: this.config.rateLimitEnabled,
        config: this.config.rateLimit,
      },
    };
  }

  /**
   * Get connection rate limit stats for an IP
   */
  getConnectionRateLimitStats(ip: string): {
    attempts: number;
    limit: number;
    windowMs: number;
  } {
    return this.connectionRateLimiter.getConnectionStats(ip);
  }

  /**
   * Get message rate limit stats for a connection
   */
  getMessageRateLimitStats(socketId: string): {
    messages: number;
    limit: number;
    windowMs: number;
    usagePercent: number;
  } {
    return this.messageRateLimiter.getMessageStats(socketId);
  }
}
