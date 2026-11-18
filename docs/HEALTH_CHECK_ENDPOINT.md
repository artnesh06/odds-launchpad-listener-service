# WebSocket Health Check Endpoint

## Overview

The `/health/websocket` endpoint provides detailed health and status information about the WebSocket server, including connection counts, room statistics, uptime, and memory usage.

## Endpoint

```
GET /health/websocket
```

## Response Format

### Success Response (200 OK)

```json
{
  "status": "healthy",
  "timestamp": "2025-12-05T01:00:00.000Z",
  "connections": {
    "active": 42,
    "max": 1000
  },
  "rooms": {
    "count": 5,
    "details": [
      {
        "name": "homepage:all",
        "clients": 15,
        "messages": 1234,
        "lastActivity": "2025-12-05T01:00:00.000Z"
      },
      {
        "name": "launchpad:0x123...",
        "clients": 8,
        "messages": 567,
        "lastActivity": "2025-12-05T00:59:30.000Z"
      }
    ]
  },
  "uptime": {
    "milliseconds": 3600000,
    "seconds": 3600,
    "minutes": 60
  },
  "memory": {
    "heapUsed": 52428800,
    "heapUsedMB": 50,
    "heapTotal": 104857600,
    "heapTotalMB": 100
  }
}
```

### Service Unavailable Response (503)

When the WebSocket server is not initialized:

```json
{
  "status": "unavailable",
  "message": "WebSocket server not initialized",
  "timestamp": "2025-12-05T01:00:00.000Z"
}
```

### Error Response (500)

When an error occurs:

```json
{
  "status": "error",
  "message": "Error details here",
  "timestamp": "2025-12-05T01:00:00.000Z"
}
```

## Response Fields

### Top Level

- `status` (string): Health status - "healthy", "unhealthy", "unavailable", or "error"
- `timestamp` (string): ISO 8601 timestamp of the response

### Connections

- `active` (number): Current number of active WebSocket connections
- `max` (number): Maximum allowed connections (from configuration)

### Rooms

- `count` (number): Total number of active rooms
- `details` (array): Array of room objects with:
  - `name` (string): Room name (e.g., "homepage:all", "launchpad:0x123...")
  - `clients` (number): Number of clients in the room
  - `messages` (number): Total messages sent to the room
  - `lastActivity` (string): ISO 8601 timestamp of last activity in the room

### Uptime

- `milliseconds` (number): Uptime in milliseconds
- `seconds` (number): Uptime in seconds (rounded down)
- `minutes` (number): Uptime in minutes (rounded down)

### Memory

- `heapUsed` (number): Heap memory used in bytes
- `heapUsedMB` (number): Heap memory used in megabytes (rounded)
- `heapTotal` (number): Total heap memory in bytes
- `heapTotalMB` (number): Total heap memory in megabytes (rounded)

## Usage Examples

### cURL

```bash
curl http://localhost:3000/health/websocket
```

### JavaScript/TypeScript

```typescript
const response = await fetch('http://localhost:3000/health/websocket');
const health = await response.json();

if (health.status === 'healthy') {
  console.log(`Active connections: ${health.connections.active}/${health.connections.max}`);
  console.log(`Active rooms: ${health.rooms.count}`);
  console.log(`Uptime: ${health.uptime.minutes} minutes`);
  console.log(`Memory: ${health.memory.heapUsedMB}MB`);
}
```

### Test Script

Use the provided test script:

```bash
npx tsx scripts/test-health-endpoint.ts
```

## Monitoring

This endpoint is designed for:

1. **Health Checks**: Monitor if the WebSocket server is running
2. **Load Monitoring**: Track active connections and room counts
3. **Performance Monitoring**: Monitor memory usage and uptime
4. **Debugging**: View detailed room statistics and activity

## Integration with Monitoring Tools

### Prometheus

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: 'websocket-health'
    metrics_path: '/health/websocket'
    static_configs:
      - targets: ['localhost:3000']
```

### Grafana

Create alerts based on:
- Connection count approaching max
- Memory usage exceeding threshold
- Room count anomalies
- Uptime resets (indicating restarts)

## Related Endpoints

- `/health` - General service health check (includes all services)
- `/sync-missing` - Trigger missing NFT sync

## Requirements Validation

This endpoint satisfies the following requirements:

- **Requirement 9.1**: Expose health check endpoints
- **Requirement 9.2**: Track and report active connections per room
- **Requirement 9.3**: Log message counts and delivery rates
- **Requirement 9.5**: Return WebSocket server status and statistics

## Notes

- The endpoint returns 503 if the WebSocket server is not initialized
- Room details are sorted by room name
- Memory metrics reflect the entire Node.js process, not just WebSocket usage
- Uptime is measured from when the WebSocket Manager was initialized
