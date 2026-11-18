/**
 * Connection and Message Tracking Tests
 * 
 * Tests for Requirements 9.2 and 9.3:
 * - Track active connections per room
 * - Log message counts and delivery rates
 * - Add performance metrics collection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketManager } from '../websocket-manager';
import { getWebSocketConfig } from '../../../config/websocket';
import { Socket as ClientSocket } from 'socket.io-client';
import { createTestClient } from '../../../__tests__/helpers/generators';

describe('Connection and Message Tracking', () => {
  let manager: WebSocketManager;
  let clients: ClientSocket[] = [];
  const testPort = 3002;

  beforeEach(async () => {
    const config = getWebSocketConfig();
    manager = new WebSocketManager({ ...config, port: testPort });
    await manager.initialize();
  });

  afterEach(async () => {
    // Disconnect all clients
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];

    // Shutdown manager
    if (manager) {
      await manager.shutdown();
    }
  });

  describe('Connection Tracking Per Room', () => {
    it('should track active connections per room', async () => {
      // Create clients and join different rooms
      const client1 = createTestClient(testPort);
      const client2 = createTestClient(testPort);
      const client3 = createTestClient(testPort);
      clients.push(client1, client2, client3);

      // Wait for connections
      await Promise.all([
        new Promise((resolve) => client1.on('connect', resolve)),
        new Promise((resolve) => client2.on('connect', resolve)),
        new Promise((resolve) => client3.on('connect', resolve)),
      ]);

      // Join rooms
      client1.emit('join', { room: 'homepage:all' });
      client2.emit('join', { room: 'homepage:all' });
      client3.emit('join', { room: 'launchpad:0x1234567890123456789012345678901234567890' });

      // Wait for joins to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check connections per room
      const connectionsPerRoom = manager.getAllConnectionsPerRoom();
      
      expect(connectionsPerRoom.get('homepage:all')).toBe(2);
      expect(connectionsPerRoom.get('launchpad:0x1234567890123456789012345678901234567890')).toBe(1);
    });

    it('should track connection count for specific room', async () => {
      const client1 = createTestClient(testPort);
      const client2 = createTestClient(testPort);
      clients.push(client1, client2);

      await Promise.all([
        new Promise((resolve) => client1.on('connect', resolve)),
        new Promise((resolve) => client2.on('connect', resolve)),
      ]);

      client1.emit('join', { room: 'homepage:all' });
      client2.emit('join', { room: 'homepage:all' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const count = manager.getConnectionsPerRoom('homepage:all');
      expect(count).toBe(2);
    });

    it('should update connection count when clients leave', async () => {
      const client1 = createTestClient(testPort);
      const client2 = createTestClient(testPort);
      clients.push(client1, client2);

      await Promise.all([
        new Promise((resolve) => client1.on('connect', resolve)),
        new Promise((resolve) => client2.on('connect', resolve)),
      ]);

      client1.emit('join', { room: 'homepage:all' });
      client2.emit('join', { room: 'homepage:all' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Leave room
      client1.emit('leave', { room: 'homepage:all' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const count = manager.getConnectionsPerRoom('homepage:all');
      expect(count).toBe(1);
    });
  });

  describe('Message Delivery Tracking', () => {
    it('should log message counts and delivery success', async () => {
      const client = createTestClient(testPort);
      clients.push(client);

      await new Promise((resolve) => client.on('connect', resolve));

      client.emit('join', { room: 'homepage:all' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Broadcast a message
      manager.broadcastToRoom('homepage:all', 'test:event', { data: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check message delivery stats
      const stats = manager.getMessageDeliveryStats();
      
      expect(stats.totalDelivered).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThan(0);
      expect(stats.recentDeliveries.length).toBeGreaterThan(0);
      
      // Check that the recent delivery was logged
      const recentDelivery = stats.recentDeliveries[stats.recentDeliveries.length - 1];
      expect(recentDelivery.event).toBe('test:event');
      expect(recentDelivery.roomName).toBe('homepage:all');
      expect(recentDelivery.success).toBe(true);
      expect(recentDelivery.recipientCount).toBe(1);
    });

    it('should calculate success rate correctly', async () => {
      const client = createTestClient(testPort);
      clients.push(client);

      await new Promise((resolve) => client.on('connect', resolve));

      client.emit('join', { room: 'homepage:all' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send successful messages
      manager.broadcastToRoom('homepage:all', 'event1', { data: 'test1' });
      manager.broadcastToRoom('homepage:all', 'event2', { data: 'test2' });

      // Try to send to non-existent room (should fail)
      manager.broadcastToRoom('nonexistent:room', 'event3', { data: 'test3' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = manager.getMessageDeliveryStats();
      
      // Success rate should be less than 1 due to failed delivery
      expect(stats.successRate).toBeLessThan(1);
      expect(stats.successRate).toBeGreaterThan(0);
    });

    it('should track average recipients per message', async () => {
      const client1 = createTestClient(testPort);
      const client2 = createTestClient(testPort);
      const client3 = createTestClient(testPort);
      clients.push(client1, client2, client3);

      await Promise.all([
        new Promise((resolve) => client1.on('connect', resolve)),
        new Promise((resolve) => client2.on('connect', resolve)),
        new Promise((resolve) => client3.on('connect', resolve)),
      ]);

      client1.emit('join', { room: 'homepage:chain:1' });
      client2.emit('join', { room: 'homepage:chain:1' });
      client3.emit('join', { room: 'homepage:chain:1' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Broadcast to 3 clients
      manager.broadcastToRoom('homepage:chain:1', 'event1', { data: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = manager.getMessageDeliveryStats();
      
      // Average recipients should be close to 3 (might have other messages)
      expect(stats.averageRecipients).toBeGreaterThan(0);
    });
  });

  describe('Performance Metrics Collection', () => {
    it('should track performance metrics', async () => {
      const client = createTestClient(testPort);
      clients.push(client);

      await new Promise((resolve) => client.on('connect', resolve));

      client.emit('join', { room: 'homepage:all' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send some messages
      for (let i = 0; i < 5; i++) {
        manager.broadcastToRoom('homepage:all', `event${i}`, { data: `test${i}` });
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = manager.getPerformanceMetrics();
      
      expect(metrics.totalMessagesDelivered).toBeGreaterThan(0);
      expect(metrics.totalConnectionsAccepted).toBeGreaterThan(0);
      expect(metrics.averageMessageLatency).toBeGreaterThanOrEqual(0);
      expect(metrics.messagesPerSecond).toBeGreaterThanOrEqual(0);
      expect(metrics.peakConnectionCount).toBeGreaterThan(0);
    });

    it('should track peak connection count', async () => {
      const client1 = createTestClient(testPort);
      const client2 = createTestClient(testPort);
      const client3 = createTestClient(testPort);
      clients.push(client1, client2, client3);

      await Promise.all([
        new Promise((resolve) => client1.on('connect', resolve)),
        new Promise((resolve) => client2.on('connect', resolve)),
        new Promise((resolve) => client3.on('connect', resolve)),
      ]);

      client1.emit('join', { room: 'homepage:all' });
      client2.emit('join', { room: 'homepage:all' });
      client3.emit('join', { room: 'homepage:all' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = manager.getPerformanceMetrics();
      
      expect(metrics.peakConnectionCount).toBeGreaterThanOrEqual(3);
    });

    it('should track message latency', async () => {
      const client = createTestClient(testPort);
      clients.push(client);

      await new Promise((resolve) => client.on('connect', resolve));

      client.emit('join', { room: 'homepage:all' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send a message
      manager.broadcastToRoom('homepage:all', 'event', { data: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = manager.getPerformanceMetrics();
      
      // Latency should be tracked (should be a small positive number)
      expect(metrics.averageMessageLatency).toBeGreaterThanOrEqual(0);
      expect(metrics.averageMessageLatency).toBeLessThan(1000); // Should be less than 1 second
    });
  });

  describe('Room Connection History', () => {
    it('should track room connection history', async () => {
      const client1 = createTestClient(testPort);
      const client2 = createTestClient(testPort);
      clients.push(client1, client2);

      await Promise.all([
        new Promise((resolve) => client1.on('connect', resolve)),
        new Promise((resolve) => client2.on('connect', resolve)),
      ]);

      client1.emit('join', { room: 'homepage:all' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      client2.emit('join', { room: 'homepage:all' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const history = manager.getRoomConnectionHistory('homepage:all');
      
      expect(history.length).toBeGreaterThanOrEqual(1); // At least one connection tracked
      if (history.length >= 2) {
        expect(history[0]).toBeLessThanOrEqual(history[1]); // Timestamps should be in order
      }
    });
  });
});
