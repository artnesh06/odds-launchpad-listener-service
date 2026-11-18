/**
 * Anomaly Detector Tests
 * 
 * Tests for anomaly detection functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnomalyDetector,
  AnomalyType,
  AnomalySeverity,
} from '../anomaly-detector';

describe('Anomaly Detector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  describe('Memory Anomalies', () => {
    it('should detect high memory usage', () => {
      // Use actual heap stats to get realistic values
      const heapStats = process.memoryUsage();
      const heapLimit = (heapStats as any).heapLimit || heapStats.heapTotal * 2;
      const highMemory = heapLimit * 0.85; // 85% usage

      const anomalies = detector.checkForAnomalies({
        memoryUsage: highMemory,
        connectionCount: 10,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const memoryAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.MEMORY_LEAK
      );

      expect(memoryAnomalies.length).toBeGreaterThan(0);
      // Should be HIGH or CRITICAL depending on actual heap limit
      expect([AnomalySeverity.HIGH, AnomalySeverity.CRITICAL]).toContain(
        memoryAnomalies[0].severity
      );
    });

    it('should detect critical memory usage', () => {
      // Use actual heap stats to get realistic values
      const heapStats = process.memoryUsage();
      const heapLimit = (heapStats as any).heapLimit || heapStats.heapTotal * 2;
      const criticalMemory = heapLimit * 0.95; // 95% usage

      const anomalies = detector.checkForAnomalies({
        memoryUsage: criticalMemory,
        connectionCount: 10,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const memoryAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.MEMORY_LEAK
      );

      expect(memoryAnomalies.length).toBeGreaterThan(0);
      expect(memoryAnomalies[0].severity).toBe(AnomalySeverity.CRITICAL);
    });
  });

  describe('Connection Anomalies', () => {
    it('should detect high connection count', () => {
      const anomalies = detector.checkForAnomalies({
        memoryUsage: 100 * 1024 * 1024, // 100MB
        connectionCount: 850,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const connectionAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.RESOURCE_EXHAUSTION
      );

      expect(connectionAnomalies.length).toBeGreaterThan(0);
      expect(connectionAnomalies[0].severity).toBe(AnomalySeverity.HIGH);
    });

    it('should detect connection limit nearly reached', () => {
      const anomalies = detector.checkForAnomalies({
        memoryUsage: 100 * 1024 * 1024, // 100MB
        connectionCount: 980,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const connectionAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.RESOURCE_EXHAUSTION
      );

      expect(connectionAnomalies.length).toBeGreaterThan(0);
      expect(connectionAnomalies[0].severity).toBe(AnomalySeverity.CRITICAL);
    });
  });

  describe('Stale Connections', () => {
    it('should detect stale connections', () => {
      const now = new Date();
      const staleTime = new Date(now.getTime() - 35 * 60 * 1000); // 35 minutes ago

      const connections = [
        { socketId: 'socket1', lastActivity: staleTime },
        { socketId: 'socket2', lastActivity: staleTime },
        { socketId: 'socket3', lastActivity: now },
      ];

      const anomalies = detector.checkForAnomalies({
        memoryUsage: 100 * 1024 * 1024,
        connectionCount: 3,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections,
      });

      const staleAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.STALE_CONNECTIONS
      );

      expect(staleAnomalies.length).toBeGreaterThan(0);
      expect(staleAnomalies[0].metrics.staleCount).toBe(2);
    });

    it('should not detect stale connections when all are active', () => {
      const now = new Date();

      const connections = [
        { socketId: 'socket1', lastActivity: now },
        { socketId: 'socket2', lastActivity: now },
        { socketId: 'socket3', lastActivity: now },
      ];

      const anomalies = detector.checkForAnomalies({
        memoryUsage: 100 * 1024 * 1024,
        connectionCount: 3,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections,
      });

      const staleAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.STALE_CONNECTIONS
      );

      expect(staleAnomalies.length).toBe(0);
    });
  });

  describe('Anomaly Statistics', () => {
    it('should track anomaly statistics', () => {
      // Trigger multiple anomalies
      detector.checkForAnomalies({
        memoryUsage: 900 * 1024 * 1024,
        connectionCount: 850,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const stats = detector.getAnomalyStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType).toBeDefined();
      expect(stats.bySeverity).toBeDefined();
    });

    it('should retrieve detected anomalies', () => {
      detector.checkForAnomalies({
        memoryUsage: 900 * 1024 * 1024,
        connectionCount: 850,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const anomalies = detector.getDetectedAnomalies();

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0]).toHaveProperty('type');
      expect(anomalies[0]).toHaveProperty('severity');
      expect(anomalies[0]).toHaveProperty('message');
      expect(anomalies[0]).toHaveProperty('suggestedActions');
    });
  });

  describe('Threshold Configuration', () => {
    it('should allow custom thresholds', () => {
      const customDetector = new AnomalyDetector({
        memoryWarningThreshold: 70,
        maxConnectionsWarning: 70,
      });

      const thresholds = customDetector.getThresholds();

      expect(thresholds.memoryWarningThreshold).toBe(70);
      expect(thresholds.maxConnectionsWarning).toBe(70);
    });

    it('should allow updating thresholds', () => {
      detector.updateThresholds({
        memoryWarningThreshold: 60,
      });

      const thresholds = detector.getThresholds();

      expect(thresholds.memoryWarningThreshold).toBe(60);
    });
  });

  describe('Corrective Actions', () => {
    it('should suggest corrective actions for memory anomalies', () => {
      const heapLimit = 1024 * 1024 * 1024;
      const highMemory = heapLimit * 0.95;

      const anomalies = detector.checkForAnomalies({
        memoryUsage: highMemory,
        connectionCount: 10,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const memoryAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.MEMORY_LEAK
      );

      expect(memoryAnomalies[0].suggestedActions.length).toBeGreaterThan(0);
    });

    it('should suggest corrective actions for connection anomalies', () => {
      const anomalies = detector.checkForAnomalies({
        memoryUsage: 100 * 1024 * 1024,
        connectionCount: 980,
        maxConnections: 1000,
        errorCount: 0,
        messageRate: 10,
        connections: [],
      });

      const connectionAnomalies = anomalies.filter(
        (a) => a.type === AnomalyType.RESOURCE_EXHAUSTION
      );

      expect(connectionAnomalies[0].suggestedActions.length).toBeGreaterThan(0);
    });
  });
});

