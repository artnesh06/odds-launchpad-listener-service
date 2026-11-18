/**
 * DatabaseChangeListener Tests
 * 
 * Basic tests to verify the DatabaseChangeListener functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseChangeListener } from '../change-listener';
import { EventEmitter } from '../../websocket/event-emitter';
import { WebSocketManager } from '../../websocket/websocket-manager';

describe('DatabaseChangeListener', () => {
  let listener: DatabaseChangeListener;
  let mockEventEmitter: EventEmitter;
  let mockWebSocketManager: WebSocketManager;

  beforeEach(() => {
    // Create mock WebSocketManager
    mockWebSocketManager = {
      broadcastToRoom: vi.fn(),
    } as any;

    // Create mock EventEmitter
    mockEventEmitter = new EventEmitter(mockWebSocketManager);

    // Create listener with test config
    listener = new DatabaseChangeListener(mockEventEmitter, {
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/test',
      reconnectDelay: 1000,
      maxReconnectAttempts: 3,
      pollInterval: 5000,
    });
  });

  afterEach(async () => {
    if (listener.isListening()) {
      await listener.stop();
    }
  });

  it('should create a DatabaseChangeListener instance', () => {
    expect(listener).toBeDefined();
    expect(listener.isListening()).toBe(false);
  });

  it('should have zero reconnect attempts initially', () => {
    expect(listener.getReconnectAttempts()).toBe(0);
  });

  it('should not be listening initially', () => {
    expect(listener.isListening()).toBe(false);
  });

  // Note: Integration tests that actually connect to PostgreSQL
  // should be run separately with a real database connection
});
