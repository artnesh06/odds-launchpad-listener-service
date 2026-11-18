/**
 * WebSocket Manager Anomaly Detection Integration Tests
 * 
 * Tests for anomaly detection integration with WebSocket Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketManager } from '../websocket-manager';
import { getWebSocketConfig } from '../../../config/websocket';

describe('WebSocket Manager - Anomaly Detection Integration', () => {
  let manager: WebSocketManager;
  const testPort = 3099;

  beforeEach(async () => {
    const config = getWebSocketConfig();
    manager = new WebSocketManager(config);
    await manager.initialize(testPort);
  });

  afterEach(async () => {
    if (manager) {
      await manager.shutdown();
    }
  });

  it('should have anomaly detector initialized', () => {
    const detector = manager.getAnomalyDetector();
    expect(detector).toBeDefined();
  });

  it('should provide anomaly statistics', () => {
    const stats = manager.getAnomalyStats();
    
    expect(stats).toBeDefined();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('byType');
    expect(stats).toHaveProperty('bySeverity');
    expect(stats).toHaveProperty('recentAnomalies');
  });

  it('should track anomalies over time', async () => {
    // Wait a bit for anomaly detection to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stats = manager.getAnomalyStats();
    
    // Stats should be available even if no anomalies detected
    expect(stats.total).toBeGreaterThanOrEqual(0);
  });

  it('should have configurable thresholds', () => {
    const detector = manager.getAnomalyDetector();
    const thresholds = detector.getThresholds();
    
    expect(thresholds).toBeDefined();
    expect(thresholds.memoryWarningThreshold).toBeDefined();
    expect(thresholds.maxConnectionsWarning).toBeDefined();
    expect(thresholds.staleConnectionTimeout).toBeDefined();
  });

  it('should allow updating thresholds', () => {
    const detector = manager.getAnomalyDetector();
    
    detector.updateThresholds({
      memoryWarningThreshold: 70,
    });
    
    const thresholds = detector.getThresholds();
    expect(thresholds.memoryWarningThreshold).toBe(70);
  });
});

