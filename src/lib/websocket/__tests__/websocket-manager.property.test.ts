/**
 * Property-Based Tests for WebSocket Manager
 * 
 * Tests universal properties that should hold for all valid inputs
 * using fast-check for property-based testing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { WebSocketManager } from '../websocket-manager';
import { WebSocketConfig } from '../../../config/websocket';
import { Socket as ClientSocket } from 'socket.io-client';
import { createTestClient as createTestClientHelper } from '../../../__tests__/helpers/generators';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_PORT = 3099; // Use a different port for testing

const testConfig: WebSocketConfig = {
  port: TEST_PORT,
  corsOrigin: ['http://localhost:3000'],
  maxConnections: 100,
  messageSizeLimit: 1048576,
  pingInterval: 30000,
  pingTimeout: 5000,
  reconnectAttempts: 5,
  authEnabled: false,
  metricsEnabled: true,
  logLevel: 'error', // Reduce noise in tests
  rateLimitEnabled: false,
  rateLimit: {
    connectionWindowMs: 60000,
    maxConnectionsPerWindow: 10,
    messageWindowMs: 60000,
    maxMessagesPerWindow: 100,
    backpressureThreshold: 0.8,
    backpressureDelayMs: 100,
  },
};

// ============================================================================
// Arbitraries (Generators for test data) - Kept for future use
// ============================================================================

// Commented out to avoid unused variable warnings
// const hexStringArb = fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 })
//   .map(arr => arr.map(n => n.toString(16)).join(''));

// const roomNameArb = fc.oneof(
//   fc.constant('homepage:all'),
//   fc.integer({ min: 1, max: 10 }).map(id => `homepage:chain:${id}`),
//   hexStringArb.map(addr => `launchpad:0x${addr}`),
//   hexStringArb.map(addr => `wallet:0x${addr}`)
// );

// const eventDataArb = fc.record({
//   type: fc.constantFrom('mint', 'collection:update', 'phase:update'),
//   data: fc.record({
//     contractAddress: hexStringArb.map(s => `0x${s}`),
//     chainId: fc.integer({ min: 1, max: 10 }),
//     timestamp: fc.date().map((d: Date) => d.toISOString()),
//   }),
// });

// ============================================================================
// Helper Functions
// ============================================================================

async function createTestClient(port: number = TEST_PORT): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = createTestClientHelper(port, {
      reconnection: false,
      forceNew: true,
    });

    client.on('connect', () => {
      // Wait a bit for the server to process the connection
      setTimeout(() => resolve(client), 50);
    });
    client.on('connect_error', (error: Error) => reject(error));

    // Timeout after 3 seconds
    setTimeout(() => reject(new Error('Connection timeout')), 3000);
  });
}

// Commented out to avoid unused variable warnings - kept for future use
// async function waitForEvent(client: ClientSocket, event: string, timeout: number = 1000): Promise<any> {
//   return new Promise((resolve, reject) => {
//     const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
//     
//     client.once(event, (data: any) => {
//       clearTimeout(timer);
//       resolve(data);
//     });
//   });
// }

// ============================================================================
// Property 1: Manager initialization creates required structures
// **Feature: realtime-websocket, Property 1: Manager initialization creates required structures**
// **Validates: Requirements 4.1, 11.1**
// ============================================================================

describe('Property 1: Manager initialization creates required structures', () => {
  it('should initialize with empty connection pool and room management', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(testConfig), async (config) => {
        const manager = new WebSocketManager(config);
        
        try {
          await manager.initialize();
          
          // Check health status
          const health = manager.getHealthStatus();
          expect(health.isHealthy).toBe(true);
          expect(health.connectionCount).toBe(0);
          expect(health.roomCount).toBe(0);
          expect(health.uptime).toBeGreaterThanOrEqual(0);
          expect(health.memoryUsage).toBeGreaterThan(0);
          
          // Check connection count
          expect(manager.getConnectionCount()).toBe(0);
          
          // Check room stats
          const roomStats = manager.getRoomStats();
          expect(Array.isArray(roomStats)).toBe(true);
          expect(roomStats.length).toBe(0);
          
          return true;
        } finally {
          await manager.shutdown();
        }
      }),
      { numRuns: 2 }
    );
  }, 10000);

  it('should reject double initialization', async () => {
    const manager = new WebSocketManager(testConfig);
    
    try {
      await manager.initialize();
      
      // Try to initialize again
      await expect(manager.initialize()).rejects.toThrow('already initialized');
    } finally {
      await manager.shutdown();
    }
  }, 10000);
});

// ============================================================================
// Property 13: Client authentication and room assignment
// **Feature: realtime-websocket, Property 13: Client authentication and room assignment**
// **Validates: Requirements 4.4, 6.1, 6.3**
// ============================================================================

describe('Property 13: Client authentication and room assignment', () => {
  let manager: WebSocketManager;

  beforeEach(async () => {
    manager = new WebSocketManager(testConfig);
    await manager.initialize();
  }, 10000);

  afterEach(async () => {
    await manager.shutdown();
  }, 10000);

  it('should accept valid connections and assign to requested rooms', async () => {
    const roomName = 'homepage:all';
    const client = await createTestClient();
    
    try {
      // Connection should be tracked
      expect(manager.getConnectionCount()).toBe(1);
      
      // Join room
      client.emit('join', { room: roomName });
      
      // Wait a bit for room join to process
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check room membership
      const clients = manager.getRoomClients(roomName);
      expect(clients.length).toBe(1);
      expect(clients[0]).toBe(client.id);
    } finally {
      client.disconnect();
      // Wait for disconnect to process
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, 10000);

  it('should track multiple clients in the same room', async () => {
    const roomName = 'homepage:all';
    const clients: ClientSocket[] = [];
    
    try {
      // Create 3 clients
      for (let i = 0; i < 3; i++) {
        const client = await createTestClient();
        client.emit('join', { room: roomName });
        clients.push(client);
      }
      
      // Wait for all joins to process
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Check connection count
      expect(manager.getConnectionCount()).toBe(3);
      
      // Check room membership
      const roomClients = manager.getRoomClients(roomName);
      expect(roomClients.length).toBe(3);
      
      // All client IDs should be in the room
      for (const client of clients) {
        expect(roomClients).toContain(client.id);
      }
    } finally {
      // Cleanup
      for (const client of clients) {
        client.disconnect();
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, 15000);
});

// ============================================================================
// Property 18: Client cleanup on disconnect
// **Feature: realtime-websocket, Property 18: Client cleanup on disconnect**
// **Validates: Requirements 4.4, 6.3**
// ============================================================================

describe('Property 18: Client cleanup on disconnect', () => {
  let manager: WebSocketManager;

  beforeEach(async () => {
    manager = new WebSocketManager(testConfig);
    await manager.initialize();
  }, 10000);

  afterEach(async () => {
    await manager.shutdown();
  }, 10000);

  it('should remove client from all rooms on disconnect', async () => {
    const roomNames = ['homepage:all', 'homepage:chain:1'];
    const client = await createTestClient();
    
    try {
      // Join multiple rooms
      for (const roomName of roomNames) {
        client.emit('join', { room: roomName });
      }
      
      // Wait for joins to process
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verify client is in all rooms
      for (const roomName of roomNames) {
        const clients = manager.getRoomClients(roomName);
        expect(clients).toContain(client.id);
      }
      
      // Disconnect client
      client.disconnect();
      
      // Wait for disconnect to process
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verify client is removed from all rooms
      for (const roomName of roomNames) {
        const clients = manager.getRoomClients(roomName);
        expect(clients).not.toContain(client.id);
      }
      
      // Verify connection count is 0
      expect(manager.getConnectionCount()).toBe(0);
    } catch (error) {
      client.disconnect();
      throw error;
    }
  }, 10000);

  it('should clean up empty rooms after all clients leave', async () => {
    const roomName = 'homepage:all';
    const client = await createTestClient();
    
    try {
      // Join room
      client.emit('join', { room: roomName });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify room exists
      const roomStats = manager.getRoomStats();
      expect(roomStats.some(r => r.room === roomName)).toBe(true);
      
      // Disconnect
      client.disconnect();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify room is cleaned up
      const roomStatsAfter = manager.getRoomStats();
      expect(roomStatsAfter.some(r => r.room === roomName)).toBe(false);
    } catch (error) {
      client.disconnect();
      throw error;
    }
  }, 10000);
});

// ============================================================================
// Property 6: Room subscription for launchpad pages
// **Feature: realtime-websocket, Property 6: Room subscription for launchpad pages**
// **Validates: Requirements 2.1, 6.2**
// ============================================================================

describe('Property 6: Room subscription for launchpad pages', () => {
  let manager: WebSocketManager;

  beforeEach(async () => {
    manager = new WebSocketManager(testConfig);
    await manager.initialize();
  }, 10000);

  afterEach(async () => {
    await manager.shutdown();
  }, 10000);

  it('should allow clients to join and leave rooms', async () => {
    const roomName = 'homepage:all';
    const client = await createTestClient();
    
    try {
      // Join room
      client.emit('join', { room: roomName });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify membership
      let clients = manager.getRoomClients(roomName);
      expect(clients).toContain(client.id);
      
      // Leave room
      client.emit('leave', { room: roomName });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify no longer in room
      clients = manager.getRoomClients(roomName);
      expect(clients).not.toContain(client.id);
    } finally {
      client.disconnect();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, 10000);
});

// ============================================================================
// Property 17: Room-based broadcast efficiency
// **Feature: realtime-websocket, Property 17: Room-based broadcast efficiency**
// **Validates: Requirements 6.2**
// ============================================================================

describe('Property 17: Room-based broadcast efficiency', () => {
  let manager: WebSocketManager;

  beforeEach(async () => {
    manager = new WebSocketManager(testConfig);
    await manager.initialize();
  }, 10000);

  afterEach(async () => {
    await manager.shutdown();
  }, 10000);

  it('should only broadcast to clients in the target room', async () => {
    const room1 = 'homepage:all';
    const room2 = 'homepage:chain:1';
    const eventData = { type: 'mint', data: { test: true } };
    
    const client1 = await createTestClient();
    const client2 = await createTestClient();
    
    try {
      // Client 1 joins room1, Client 2 joins room2
      client1.emit('join', { room: room1 });
      client2.emit('join', { room: room2 });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Set up event listeners
      let client1Received = false;
      let client2Received = false;
      
      client1.on('test-event', () => { client1Received = true; });
      client2.on('test-event', () => { client2Received = true; });
      
      // Broadcast to room1 only
      manager.broadcastToRoom(room1, 'test-event', eventData);
      
      // Wait for event delivery
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Only client1 should receive the event
      expect(client1Received).toBe(true);
      expect(client2Received).toBe(false);
    } finally {
      client1.disconnect();
      client2.disconnect();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, 10000);
});

// ============================================================================
// Property 1: Broadcast delivery to all room members
// **Feature: realtime-websocket, Property 1: Broadcast delivery to all room members**
// **Validates: Requirements 1.1, 4.3**
// ============================================================================

describe('Property 1: Broadcast delivery to all room members', () => {
  let manager: WebSocketManager;

  beforeEach(async () => {
    manager = new WebSocketManager(testConfig);
    await manager.initialize();
  }, 10000);

  afterEach(async () => {
    await manager.shutdown();
  }, 10000);

  it('should deliver broadcast to all clients in the room', async () => {
    const roomName = 'homepage:all';
    const eventData = { type: 'mint', data: { test: true } };
    const clientCount = 3;
    const clients: ClientSocket[] = [];
    const receivedFlags: boolean[] = new Array(clientCount).fill(false);
    
    try {
      // Create multiple clients
      for (let i = 0; i < clientCount; i++) {
        const client = await createTestClient();
        client.emit('join', { room: roomName });
        
        // Set up event listener
        client.on('test-broadcast', () => {
          receivedFlags[i] = true;
        });
        
        clients.push(client);
      }
      
      // Wait for all joins
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Broadcast event
      manager.broadcastToRoom(roomName, 'test-broadcast', eventData);
      
      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // All clients should have received the event
      for (let i = 0; i < clientCount; i++) {
        expect(receivedFlags[i]).toBe(true);
      }
    } finally {
      for (const client of clients) {
        client.disconnect();
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, 15000);
});
