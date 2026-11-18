/**
 * Unit tests for Blockchain WebSocket Metrics Collector
 * 
 * Tests metrics collection for WebSocket connections and event processing
 * 
 * Requirements: 8.4, 8.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { blockchainWebSocketMetrics } from '../blockchain-websocket-metrics';

describe('BlockchainWebSocketMetrics', () => {
  beforeEach(() => {
    // Reset metrics before each test
    blockchainWebSocketMetrics.reset();
  });

  describe('Active Connections Tracking', () => {
    it('should track active WebSocket connections', () => {
      blockchainWebSocketMetrics.setActiveConnections(5);
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.activeWebSocketConnections).toBe(5);
    });

    it('should update active connections count', () => {
      blockchainWebSocketMetrics.setActiveConnections(3);
      expect(blockchainWebSocketMetrics.getMetrics().activeWebSocketConnections).toBe(3);
      
      blockchainWebSocketMetrics.setActiveConnections(7);
      expect(blockchainWebSocketMetrics.getMetrics().activeWebSocketConnections).toBe(7);
    });

    it('should handle zero connections', () => {
      blockchainWebSocketMetrics.setActiveConnections(5);
      blockchainWebSocketMetrics.setActiveConnections(0);
      
      expect(blockchainWebSocketMetrics.getMetrics().activeWebSocketConnections).toBe(0);
    });
  });

  describe('Mint Events Tracking', () => {
    it('should increment WebSocket mint events counter', () => {
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.mintEventsWebSocket).toBe(3);
    });

    it('should increment polling mint events counter', () => {
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.mintEventsPolling).toBe(2);
    });

    it('should track both WebSocket and polling events independently', () => {
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.mintEventsWebSocket).toBe(3);
      expect(metrics.mintEventsPolling).toBe(3);
    });
  });

  describe('Reconnection Attempts Tracking', () => {
    it('should increment reconnection attempts counter', () => {
      blockchainWebSocketMetrics.incrementReconnectionAttempts();
      blockchainWebSocketMetrics.incrementReconnectionAttempts();
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.websocketReconnectionAttempts).toBe(2);
    });

    it('should track multiple reconnection attempts', () => {
      for (let i = 0; i < 10; i++) {
        blockchainWebSocketMetrics.incrementReconnectionAttempts();
      }
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.websocketReconnectionAttempts).toBe(10);
    });
  });

  describe('WebSocket Errors Tracking', () => {
    it('should increment WebSocket errors counter', () => {
      blockchainWebSocketMetrics.incrementWebSocketErrors();
      blockchainWebSocketMetrics.incrementWebSocketErrors();
      blockchainWebSocketMetrics.incrementWebSocketErrors();
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.websocketErrors).toBe(3);
    });
  });

  describe('Metrics Reset', () => {
    it('should reset all metrics to zero', () => {
      // Set various metrics
      blockchainWebSocketMetrics.setActiveConnections(5);
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      blockchainWebSocketMetrics.incrementReconnectionAttempts();
      blockchainWebSocketMetrics.incrementWebSocketErrors();
      
      // Reset
      blockchainWebSocketMetrics.reset();
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.activeWebSocketConnections).toBe(0);
      expect(metrics.mintEventsWebSocket).toBe(0);
      expect(metrics.mintEventsPolling).toBe(0);
      expect(metrics.websocketReconnectionAttempts).toBe(0);
      expect(metrics.websocketErrors).toBe(0);
    });
  });

  describe('Metrics Snapshot', () => {
    it('should return a snapshot of current metrics', () => {
      blockchainWebSocketMetrics.setActiveConnections(3);
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      
      expect(metrics).toHaveProperty('activeWebSocketConnections');
      expect(metrics).toHaveProperty('mintEventsWebSocket');
      expect(metrics).toHaveProperty('mintEventsPolling');
      expect(metrics).toHaveProperty('websocketReconnectionAttempts');
      expect(metrics).toHaveProperty('websocketErrors');
      expect(metrics).toHaveProperty('lastUpdated');
      expect(metrics.lastUpdated).toBeInstanceOf(Date);
    });

    it('should not allow external modification of metrics', () => {
      blockchainWebSocketMetrics.setActiveConnections(5);
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      metrics.activeWebSocketConnections = 999;
      
      // Original metrics should be unchanged
      const freshMetrics = blockchainWebSocketMetrics.getMetrics();
      expect(freshMetrics.activeWebSocketConnections).toBe(5);
    });
  });

  describe('Last Updated Timestamp', () => {
    it('should update lastUpdated timestamp when metrics change', () => {
      const before = new Date();
      
      blockchainWebSocketMetrics.setActiveConnections(1);
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.lastUpdated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should update timestamp for each metric change', () => {
      blockchainWebSocketMetrics.setActiveConnections(1);
      const firstUpdate = blockchainWebSocketMetrics.getMetrics().lastUpdated;
      
      // Wait a bit
      const waitPromise = new Promise(resolve => setTimeout(resolve, 10));
      
      return waitPromise.then(() => {
        blockchainWebSocketMetrics.incrementMintEventsWebSocket();
        const secondUpdate = blockchainWebSocketMetrics.getMetrics().lastUpdated;
        
        expect(secondUpdate.getTime()).toBeGreaterThanOrEqual(firstUpdate.getTime());
      });
    });
  });

  describe('Formatted Metrics', () => {
    it('should return formatted metrics string', () => {
      blockchainWebSocketMetrics.setActiveConnections(3);
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      
      const formatted = blockchainWebSocketMetrics.getFormattedMetrics();
      
      expect(formatted).toContain('Blockchain WebSocket Metrics');
      expect(formatted).toContain('Active Connections: 3');
      expect(formatted).toContain('Mint Events (WebSocket): 1');
      expect(formatted).toContain('Mint Events (Polling): 1');
      expect(formatted).toContain('Reconnection Attempts: 0');
      expect(formatted).toContain('WebSocket Errors: 0');
      expect(formatted).toContain('Last Updated:');
    });
  });

  describe('Integration Scenarios', () => {
    it('should track a complete WebSocket lifecycle', () => {
      // Initialize with 3 connections
      blockchainWebSocketMetrics.setActiveConnections(3);
      
      // Process some events
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsPolling();
      
      // Connection error occurs
      blockchainWebSocketMetrics.incrementWebSocketErrors();
      
      // Reconnection attempt
      blockchainWebSocketMetrics.incrementReconnectionAttempts();
      
      // Connection restored
      blockchainWebSocketMetrics.setActiveConnections(3);
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.activeWebSocketConnections).toBe(3);
      expect(metrics.mintEventsWebSocket).toBe(2);
      expect(metrics.mintEventsPolling).toBe(1);
      expect(metrics.websocketReconnectionAttempts).toBe(1);
      expect(metrics.websocketErrors).toBe(1);
    });

    it('should track shutdown scenario', () => {
      // Start with connections
      blockchainWebSocketMetrics.setActiveConnections(5);
      
      // Process events
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
      
      // Shutdown all connections
      blockchainWebSocketMetrics.setActiveConnections(0);
      
      const metrics = blockchainWebSocketMetrics.getMetrics();
      expect(metrics.activeWebSocketConnections).toBe(0);
      expect(metrics.mintEventsWebSocket).toBe(2); // Events counter persists
    });
  });
});

