import Redis from 'ioredis';
import { getRedisConfig } from './queue-config';

/**
 * Check if Redis is available and connectable
 * @returns Promise<boolean> - true if Redis is available, false otherwise
 */
export async function isRedisAvailable(): Promise<boolean> {
  const config = getRedisConfig();
  
  // Create a test Redis client with short timeout
  const testClient = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    connectTimeout: 2000, // 2 second timeout
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Don't retry
    lazyConnect: true, // Don't connect immediately
    enableOfflineQueue: false, // Don't queue commands when offline
  });

  try {
    // Try to connect
    await testClient.connect();
    
    // Try to ping
    const result = await testClient.ping();
    
    // Close the test connection
    await testClient.quit();
    
    return result === 'PONG';
  } catch (error) {
    // Connection failed - Redis not available
    try {
      await testClient.quit();
    } catch {
      // Ignore quit errors
    }
    return false;
  }
}

/**
 * Check if Redis configuration is provided in environment
 * @returns boolean - true if Redis env vars are set
 */
export function isRedisConfigured(): boolean {
  // Check if Redis host is explicitly set (not default)
  const redisHost = process.env.REDIS_HOST;
  
  // If REDIS_HOST is not set or is set to localhost/127.0.0.1, 
  // we consider it as "not configured" for production
  if (!redisHost || redisHost === 'localhost' || redisHost === '127.0.0.1') {
    return false;
  }
  
  return true;
}
