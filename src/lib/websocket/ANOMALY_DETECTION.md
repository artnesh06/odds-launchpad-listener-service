# Anomaly Detection and Alerting

## Overview

The WebSocket Manager now includes comprehensive anomaly detection and alerting capabilities to monitor system health and automatically take corrective actions when issues are detected.

## Features

### Anomaly Types Detected

1. **Memory Leaks**
   - Monitors heap usage percentage
   - Tracks memory growth rate
   - Detects both warning (80%) and critical (90%) thresholds

2. **Connection Spikes**
   - Tracks connection rate (connections per minute)
   - Monitors connection count relative to maximum
   - Detects unusual connection patterns

3. **High Error Rates**
   - Monitors error frequency
   - Tracks error rate per minute
   - Distinguishes between warning and critical error rates

4. **Stale Connections**
   - Identifies inactive connections (default: 30 minutes)
   - Tracks last activity timestamp
   - Suggests cleanup actions

5. **Resource Exhaustion**
   - Monitors connection limits
   - Tracks resource usage
   - Alerts when approaching capacity

### Corrective Actions

The system automatically executes corrective actions when anomalies are detected:

1. **Cleanup Stale Connections** - Disconnects inactive clients
2. **Force Garbage Collection** - Triggers GC when available (requires --expose-gc flag)
3. **Close Idle Connections** - Closes oldest 10% of idle connections
4. **Clear Message History** - Reduces memory by clearing old message logs
5. **Emit Warnings** - Broadcasts system warnings to monitoring tools

### Severity Levels

- **LOW** - Minor issues, informational
- **MEDIUM** - Potential problems, monitoring recommended
- **HIGH** - Significant issues, action recommended
- **CRITICAL** - Severe problems, immediate action required

## Configuration

### Default Thresholds

```typescript
{
  memoryWarningThreshold: 80,      // 80% of heap limit
  memoryCriticalThreshold: 90,     // 90% of heap limit
  memoryGrowthRate: 50,            // 50MB per minute
  connectionSpikeThreshold: 100,   // 100 connections per minute
  maxConnectionsWarning: 80,       // 80% of max connections
  errorRateWarning: 10,            // 10 errors per minute
  errorRateCritical: 50,           // 50 errors per minute
  messageFloodThreshold: 100,      // 100 messages per second per connection
  staleConnectionTimeout: 30,      // 30 minutes of inactivity
}
```

### Customizing Thresholds

```typescript
const detector = manager.getAnomalyDetector();
detector.updateThresholds({
  memoryWarningThreshold: 70,
  maxConnectionsWarning: 70,
});
```

## Monitoring

### Health Check Endpoint

The `/health/websocket` endpoint now includes anomaly statistics:

```json
{
  "anomalies": {
    "total": 5,
    "byType": {
      "memory_leak": 2,
      "connection_spike": 1,
      "high_error_rate": 1,
      "stale_connections": 1
    },
    "bySeverity": {
      "low": 1,
      "medium": 2,
      "high": 1,
      "critical": 1
    },
    "recent": [
      {
        "type": "memory_leak",
        "severity": "high",
        "message": "High memory usage: 85.0% of heap limit",
        "timestamp": "2025-12-05T01:00:00.000Z",
        "suggestedActions": ["cleanup_stale_connections", "clear_message_history"]
      }
    ]
  }
}
```

### Programmatic Access

```typescript
// Get anomaly statistics
const stats = manager.getAnomalyStats();

// Get recent anomalies
const detector = manager.getAnomalyDetector();
const recentAnomalies = detector.getDetectedAnomalies(undefined, undefined, 10);

// Get anomalies by type
const memoryAnomalies = detector.getDetectedAnomalies(AnomalyType.MEMORY_LEAK);

// Get anomalies by severity
const criticalAnomalies = detector.getDetectedAnomalies(undefined, AnomalySeverity.CRITICAL);
```

## Automatic Detection

Anomaly detection runs automatically every minute (configurable) once the WebSocket Manager is initialized. The system:

1. Collects current metrics (memory, connections, errors)
2. Analyzes metrics against thresholds
3. Detects anomalies
4. Logs warnings
5. Executes corrective actions
6. Emits system warnings for critical issues

## System Warnings

Critical and high-severity anomalies trigger system-wide warnings that are broadcast to all connected clients:

```typescript
socket.on('system:anomaly', (data) => {
  console.log('System anomaly detected:', data);
  // {
  //   type: 'memory_leak',
  //   severity: 'critical',
  //   message: 'Critical memory usage: 95.0% of heap limit',
  //   timestamp: '2025-12-05T01:00:00.000Z'
  // }
});
```

## Testing

Comprehensive tests are available:

- `anomaly-detector.test.ts` - Unit tests for anomaly detection logic
- `websocket-manager-anomaly.test.ts` - Integration tests with WebSocket Manager

Run tests:
```bash
npm test -- anomaly-detector --run
npm test -- websocket-manager-anomaly --run
```

## Best Practices

1. **Monitor the health endpoint** regularly to track anomaly trends
2. **Set appropriate thresholds** based on your system's capacity
3. **Enable garbage collection** with `--expose-gc` flag for better memory management
4. **Review anomaly logs** to identify patterns and optimize system configuration
5. **Implement alerting** based on critical anomalies for production systems

## Future Enhancements

- Configurable anomaly check interval
- Custom anomaly handlers
- Anomaly prediction using historical data
- Integration with external monitoring systems (Prometheus, Grafana)
- Automatic threshold adjustment based on system behavior

