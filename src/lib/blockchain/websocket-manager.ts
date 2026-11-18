/**
 * WebSocketManager - Manages WebSocket connections for featured launchpads (Multi-Chain)
 * 
 * This class manages WebSocket connections to blockchain contracts for real-time
 * mint event monitoring on featured launchpads. It uses ethers.js contract.on()
 * for WebSocket-based event listening.
 * 
 * Features:
 * - Establishes WebSocket connections for featured launchpads
 * - Registers Mint event listeners using contract.on()
 * - Manages connection lifecycle (add/remove/shutdown)
 * - Tracks connection status and health
 * - Integrates with EventProcessor for event deduplication
 * - Multi-chain support: Each chain has its own WebSocketManager instance
 * 
 * Requirements: 2.1, 5.5
 */

import { ethers } from 'ethers';
import { EventProcessor } from '../processors/event-processor';
import OddsLaunchpadABI from '../../../abi/OddsLaunchpad.json';
import { prisma } from '../../config/database';
import { logError } from '../../utils/error-logger';
import { blockchainWebSocketMetrics } from '../monitoring/blockchain-websocket-metrics';

/**
 * Connection status for a launchpad WebSocket connection
 */
export interface ConnectionStatus {
  isConnected: boolean;
  launchpadAddress: string;
  connectedAt?: Date;
  lastError?: Error;
  reconnectAttempts: number;
}

/**
 * Internal connection state tracking
 */
interface ContractConnection {
  contract: ethers.Contract;
  listener: (...args: any[]) => void;
  connectedAt: Date;
  reconnectAttempts: number;
  lastError?: Error;
}

/**
 * WebSocketManager class for managing blockchain WebSocket connections
 * Multi-chain: Each chain has its own WebSocketManager instance
 */
export class WebSocketManager {
  private connections: Map<string, ContractConnection>;
  private provider: ethers.WebSocketProvider;
  private eventProcessor: EventProcessor;
  private chainId: number; // Chain ID for this manager instance

  /**
   * Create a new WebSocketManager for a specific chain
   * 
   * @param chainId - Chain ID for this manager
   * @param provider - WebSocket provider for blockchain connections
   * @param eventProcessor - Event processor for handling mint events
   */
  constructor(
    chainId: number,
    provider: ethers.WebSocketProvider,
    eventProcessor: EventProcessor
  ) {
    this.chainId = chainId;
    this.connections = new Map<string, ContractConnection>();
    this.provider = provider;
    this.eventProcessor = eventProcessor;

    console.log(`[WebSocketManager] Initialized for chain ${chainId} with WebSocket provider`);
  }

  /**
   * Initialize WebSocket connections for all featured launchpads on this chain
   * 
   * Queries the database for all launchpads with isFeatured=true for this specific chain
   * and establishes WebSocket connections for each.
   * 
   * @returns Promise that resolves when all connections are established
   * 
   * Requirements: 2.4, 5.1
   */
  async initialize(): Promise<void> {
    console.log(`[WebSocketManager] Initializing WebSocket connections for featured launchpads on chain ${this.chainId}...`);
    
    try {
      // 1. Query database for all featured launchpads (isFeatured=true) for this chain
      const featuredLaunchpads = await prisma.launchpad.findMany({
        where: { 
          isFeatured: true,
          chainId: this.chainId // Filter by chain ID
        },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          chainId: true
        }
      });

      console.log(`[WebSocketManager] Found ${featuredLaunchpads.length} featured launchpad(s) on chain ${this.chainId}`);

      // 2. Call addListener for each featured launchpad
      if (featuredLaunchpads.length === 0) {
        console.log(`[WebSocketManager] No featured launchpads found on chain ${this.chainId}, initialization complete`);
        return;
      }

      // Establish connections for all featured launchpads
      const connectionPromises = featuredLaunchpads.map(async (launchpad) => {
        try {
          await this.addListener(launchpad.contractAddress);
          // Requirement 8.1: Log connection establishment with launchpad address
          console.log(`[WebSocketManager] ✓ Connected to featured launchpad: ${launchpad.name} (${launchpad.contractAddress}) on chain ${this.chainId}`);
        } catch (error) {
          // Requirement 8.2: Log connection failures with error details
          console.error(`[WebSocketManager] ✗ Failed to connect to launchpad ${launchpad.name} (${launchpad.contractAddress}) on chain ${this.chainId}:`, error);
          
          // Log to centralized error logger
          logError(
            'WebSocketManager',
            error,
            {
              chainId: this.chainId,
              launchpadAddress: launchpad.contractAddress,
              launchpadName: launchpad.name,
              event: 'initialization_connection_failed',
              timestamp: new Date().toISOString()
            },
            'high'
          );
          
          // Continue with other launchpads even if one fails
        }
      });

      // Wait for all connections to be established
      await Promise.all(connectionPromises);

      // 3. Log initialization status
      const successfulConnections = this.connections.size;
      const failedConnections = featuredLaunchpads.length - successfulConnections;

      // Update metrics for active connections
      blockchainWebSocketMetrics.setActiveConnections(successfulConnections);

      console.log(`[WebSocketManager] Initialization complete for chain ${this.chainId}:`);
      console.log(`  - Total featured launchpads: ${featuredLaunchpads.length}`);
      console.log(`  - Successful connections: ${successfulConnections}`);
      console.log(`  - Failed connections: ${failedConnections}`);

      if (successfulConnections > 0) {
        console.log(`[WebSocketManager] ✅ WebSocket monitoring active for featured launchpads on chain ${this.chainId}`);
      }
      
      if (failedConnections > 0) {
        console.warn(`[WebSocketManager] ⚠️ Some connections failed on chain ${this.chainId}, check logs for details`);
      }
    } catch (error) {
      console.error(`[WebSocketManager] Error during initialization on chain ${this.chainId}:`, error);
      throw error;
    }
  }

  /**
   * Add WebSocket listener for a specific launchpad
   * 
   * Creates an ethers.Contract instance and registers a Mint event listener
   * using contract.on(). Stores the connection reference for management.
   * 
   * @param launchpadAddress - Address of the launchpad contract
   * @returns Promise that resolves when listener is added
   * 
   * Requirements: 2.1, 2.2, 5.2
   */
  async addListener(launchpadAddress: string): Promise<void> {
    console.log(`[WebSocketManager] Adding listener for launchpad: ${launchpadAddress}`);
    
    // Check if listener already exists
    if (this.connections.has(launchpadAddress)) {
      console.log(`[WebSocketManager] Listener already exists for ${launchpadAddress}`);
      return;
    }

    try {
      // 1. Create ethers.Contract instance for launchpad address
      const contract = new ethers.Contract(
        launchpadAddress,
        OddsLaunchpadABI,
        this.provider
      );

      console.log(`[WebSocketManager] Created contract instance for ${launchpadAddress}`);

      // 2. Register 'Minted' event listener using contract.on()
      // Note: The event is called "Minted" not "Mint" in the OddsLaunchpad ABI
      const listener = async (
        recipient: string,
        tokenId: ethers.BigNumber,
        phaseId: ethers.BigNumber,
        quantity: ethers.BigNumber,
        event: ethers.Event
      ) => {
        // Requirement 8.3: Log mint events received via WebSocket with transaction hash
        console.log(`[WebSocketManager] 🎉 Mint event received via WebSocket for ${launchpadAddress}:`, {
          recipient,
          tokenId: tokenId.toString(),
          phaseId: phaseId.toString(),
          quantity: quantity.toString(),
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          logIndex: event.logIndex,
          source: 'websocket'
        });

        // Process the event through EventProcessor for deduplication
        await this.eventProcessor.processMintEvent({
          from: recipient,
          tokenId: tokenId.toString(),
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          launchpadAddress,
          source: 'websocket'
        });
      };

      // Register the listener on the contract
      contract.on('Minted', listener);

      console.log(`[WebSocketManager] Registered Minted event listener for ${launchpadAddress}`);

      // 3. Store connection reference in connections Map
      this.connections.set(launchpadAddress, {
        contract,
        listener,
        connectedAt: new Date(),
        reconnectAttempts: 0
      });

      // Update metrics for active connections
      blockchainWebSocketMetrics.setActiveConnections(this.connections.size);

      // 4. Setup error handling for the connection
      this.setupErrorHandling(launchpadAddress, contract);

      console.log(`[WebSocketManager] Successfully added listener for ${launchpadAddress} (total: ${this.connections.size})`);
      
      // Requirement 8.1: Log connection establishment with launchpad address
      console.log(`[WebSocketManager] ✅ WebSocket connection established for launchpad ${launchpadAddress}`);
    } catch (error) {
      // Requirement 8.2: Log connection failures with error details
      console.error(`[WebSocketManager] Error adding listener for ${launchpadAddress}:`, error);
      
      // Log to centralized error logger
      logError(
        'WebSocketManager',
        error,
        {
          launchpadAddress,
          event: 'add_listener_failed',
          timestamp: new Date().toISOString()
        },
        'high'
      );
      
      throw error;
    }
  }

  /**
   * Setup error handling for a WebSocket connection
   * 
   * Registers error handlers on the contract's provider to detect
   * connection issues and trigger reconnection logic.
   * 
   * @param launchpadAddress - Address of the launchpad contract
   * @param contract - The ethers.Contract instance
   * 
   * Requirements: 2.5, 5.2
   */
  private setupErrorHandling(launchpadAddress: string, contract: ethers.Contract): void {
    // Check if provider exists and supports error events
    if (!contract.provider || typeof contract.provider.on !== 'function') {
      console.warn(`[WebSocketManager] Provider does not support error events for ${launchpadAddress}`);
      return;
    }

    // Listen for provider errors
    contract.provider.on('error', async (error: Error) => {
      // Increment error counter
      blockchainWebSocketMetrics.incrementWebSocketErrors();
      
      // 1. Log errors with launchpad address context
      // Requirement 8.2: Log connection failures with error details
      console.error(`[WebSocketManager] WebSocket error for launchpad ${launchpadAddress}:`, {
        launchpadAddress,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      
      // Also log to centralized error logger for monitoring
      logError(
        'WebSocketManager',
        error,
        {
          launchpadAddress,
          event: 'websocket_connection_error',
          timestamp: new Date().toISOString()
        },
        'high'
      );
      
      // 2. Update connection status with error
      const connection = this.connections.get(launchpadAddress);
      if (connection) {
        connection.lastError = error;
      }

      // 3. Trigger reconnection on error
      try {
        await this.handleReconnection(launchpadAddress);
      } catch (reconnectError) {
        console.error(`[WebSocketManager] Failed to trigger reconnection for ${launchpadAddress}:`, reconnectError);
        logError(
          'WebSocketManager',
          reconnectError,
          {
            launchpadAddress,
            event: 'reconnection_trigger_failed'
          },
          'high'
        );
      }
    });

    console.log(`[WebSocketManager] Error handling configured for ${launchpadAddress}`);
  }

  /**
   * Handle reconnection for a failed WebSocket connection
   * 
   * Implements exponential backoff strategy and attempts to re-establish
   * the WebSocket connection for a launchpad.
   * 
   * Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
   * 
   * @param launchpadAddress - Address of the launchpad contract
   * @returns Promise that resolves when reconnection is attempted
   * 
   * Requirements: 2.5, 5.3
   */
  private async handleReconnection(launchpadAddress: string): Promise<void> {
    console.log(`[WebSocketManager] Reconnection triggered for ${launchpadAddress}`);
    
    // Increment reconnection attempts counter
    blockchainWebSocketMetrics.incrementReconnectionAttempts();
    
    // Get the connection from the Map
    const connection = this.connections.get(launchpadAddress);
    if (!connection) {
      console.warn(`[WebSocketManager] No connection found for ${launchpadAddress}, cannot reconnect`);
      return;
    }

    // 1. Track reconnection attempts in connection status
    connection.reconnectAttempts++;
    const attemptNumber = connection.reconnectAttempts;

    console.log(`[WebSocketManager] Reconnection attempt #${attemptNumber} for ${launchpadAddress}`);

    // 2. Implement exponential backoff calculation (1s, 2s, 4s, 8s, 16s, max 30s)
    // Formula: min(baseDelay * 2^(attempts-1), maxDelay)
    // Attempt 1: 1000 * 2^0 = 1000ms (1s)
    // Attempt 2: 1000 * 2^1 = 2000ms (2s)
    // Attempt 3: 1000 * 2^2 = 4000ms (4s)
    // Attempt 4: 1000 * 2^3 = 8000ms (8s)
    // Attempt 5: 1000 * 2^4 = 16000ms (16s)
    // Attempt 6+: min(32000+, 30000) = 30000ms (30s)
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attemptNumber - 1), maxDelay);

    console.log(`[WebSocketManager] Waiting ${delay}ms before reconnection attempt...`);

    // Wait for the calculated delay
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // 3. Remove old listener and add new listener
      console.log(`[WebSocketManager] Removing old listener for ${launchpadAddress}...`);
      await this.removeListener(launchpadAddress);

      console.log(`[WebSocketManager] Adding new listener for ${launchpadAddress}...`);
      await this.addListener(launchpadAddress);

      // 4. Reset reconnection counter on success
      const newConnection = this.connections.get(launchpadAddress);
      if (newConnection) {
        newConnection.reconnectAttempts = 0;
        console.log(`[WebSocketManager] ✅ Successfully reconnected to ${launchpadAddress}`);
      }
      
      // Update metrics for active connections after successful reconnection
      blockchainWebSocketMetrics.setActiveConnections(this.connections.size);
    } catch (error) {
      // Requirement 8.2: Log connection failures with error details
      console.error(`[WebSocketManager] ❌ Reconnection attempt #${attemptNumber} failed for ${launchpadAddress}:`, error);
      
      // Log to centralized error logger
      logError(
        'WebSocketManager',
        error,
        {
          launchpadAddress,
          event: 'reconnection_failed',
          attemptNumber,
          timestamp: new Date().toISOString()
        },
        'high'
      );

      // 5. Send alert if max attempts exceeded
      const maxAttempts = 10; // Default from blockchain config
      if (attemptNumber >= maxAttempts) {
        console.error(`[WebSocketManager] 🚨 Max reconnection attempts (${maxAttempts}) exceeded for ${launchpadAddress}`);
        
        // Log critical error
        logError(
          'WebSocketManager',
          new Error(`Max reconnection attempts exceeded for ${launchpadAddress}`),
          {
            launchpadAddress,
            event: 'max_reconnection_attempts_exceeded',
            attempts: attemptNumber,
            timestamp: new Date().toISOString()
          },
          'critical'
        );
        
        // Send alert notification via queue system
        try {
          const { getQueueManager } = await import('../../queue/queue-manager');
          const queueManager = getQueueManager();
          
          await queueManager.addNotificationJob({
            type: 'alert',
            recipients: ['system-admin'], // System administrators
            data: {
              message: `WebSocket connection failed for launchpad ${launchpadAddress} after ${maxAttempts} reconnection attempts`,
              launchpadAddress,
              attempts: attemptNumber,
              timestamp: new Date().toISOString(),
              severity: 'high'
            },
            priority: 'high'
          });

          console.log(`[WebSocketManager] 📧 Alert notification sent for ${launchpadAddress}`);
        } catch (alertError) {
          console.error(`[WebSocketManager] Failed to send alert notification:`, alertError);
          logError(
            'WebSocketManager',
            alertError,
            {
              launchpadAddress,
              event: 'alert_notification_failed'
            },
            'medium'
          );
        }
      } else {
        // If not at max attempts yet, the error handler will trigger another reconnection
        console.log(`[WebSocketManager] Will retry reconnection (${attemptNumber}/${maxAttempts})`);
      }
    }
  }

  /**
   * Remove WebSocket listener for a specific launchpad
   * 
   * Removes the event listener from the contract and cleans up the
   * connection from the connections Map.
   * 
   * @param launchpadAddress - Address of the launchpad contract
   * @returns Promise that resolves when listener is removed
   * 
   * Requirements: 4.2
   */
  async removeListener(launchpadAddress: string): Promise<void> {
    console.log(`[WebSocketManager] Removing listener for launchpad: ${launchpadAddress}`);
    
    // Get the connection from the Map
    const connection = this.connections.get(launchpadAddress);
    
    if (!connection) {
      console.log(`[WebSocketManager] No listener found for ${launchpadAddress}`);
      return;
    }

    try {
      // 1. Remove event listener from contract
      connection.contract.off('Minted', connection.listener);
      console.log(`[WebSocketManager] Removed Minted event listener from contract for ${launchpadAddress}`);

      // 2. Clean up connection from connections Map
      this.connections.delete(launchpadAddress);
      console.log(`[WebSocketManager] Cleaned up connection from Map for ${launchpadAddress}`);

      // Update metrics for active connections
      blockchainWebSocketMetrics.setActiveConnections(this.connections.size);

      // 3. Log connection removal
      console.log(`[WebSocketManager] Successfully removed listener for ${launchpadAddress} (remaining: ${this.connections.size})`);
    } catch (error) {
      console.error(`[WebSocketManager] Error removing listener for ${launchpadAddress}:`, error);
      
      // Log to centralized error logger
      logError(
        'WebSocketManager',
        error,
        {
          launchpadAddress,
          event: 'remove_listener_failed',
          timestamp: new Date().toISOString()
        },
        'medium'
      );
      
      throw error;
    }
  }

  /**
   * Get connection status for a launchpad
   * 
   * Returns the current connection status including connection state,
   * timestamps, errors, and reconnection attempts.
   * 
   * @param launchpadAddress - Address of the launchpad contract
   * @returns ConnectionStatus object with current status
   * 
   * Requirements: 5.5
   */
  getConnectionStatus(launchpadAddress: string): ConnectionStatus {
    const connection = this.connections.get(launchpadAddress);

    if (!connection) {
      return {
        isConnected: false,
        launchpadAddress,
        reconnectAttempts: 0
      };
    }

    return {
      isConnected: true,
      launchpadAddress,
      connectedAt: connection.connectedAt,
      lastError: connection.lastError,
      reconnectAttempts: connection.reconnectAttempts
    };
  }

  /**
   * Gracefully shutdown all WebSocket connections
   * 
   * Iterates through all active connections, removes listeners,
   * and clears the connections Map.
   * 
   * @returns Promise that resolves when all connections are closed
   * 
   * Requirements: 5.4
   */
  async shutdown(): Promise<void> {
    console.log('[WebSocketManager] Shutting down all WebSocket connections...');
    
    const totalConnections = this.connections.size;
    
    if (totalConnections === 0) {
      console.log('[WebSocketManager] No active connections to shutdown');
      console.log('[WebSocketManager] ✅ Shutdown complete');
      return;
    }

    console.log(`[WebSocketManager] Found ${totalConnections} active connection(s) to shutdown`);

    // 1. Iterate through all connections
    const shutdownPromises: Promise<void>[] = [];
    
    for (const [launchpadAddress, connection] of this.connections.entries()) {
      console.log(`[WebSocketManager] Shutting down connection for ${launchpadAddress}...`);
      
      // 2. Call removeListener for each connection
      const shutdownPromise = this.removeListener(launchpadAddress)
        .then(() => {
          console.log(`[WebSocketManager] ✓ Successfully shutdown connection for ${launchpadAddress}`);
        })
        .catch((error) => {
          console.error(`[WebSocketManager] ✗ Error shutting down connection for ${launchpadAddress}:`, error);
          // Continue with other shutdowns even if one fails
        });
      
      shutdownPromises.push(shutdownPromise);
    }

    // Wait for all connections to be removed
    await Promise.all(shutdownPromises);

    // 3. Clear connections Map (should already be empty from removeListener calls)
    this.connections.clear();
    console.log('[WebSocketManager] Cleared connections Map');

    // Update metrics to reflect zero active connections
    blockchainWebSocketMetrics.setActiveConnections(0);

    // 4. Log shutdown completion
    console.log('[WebSocketManager] ✅ Shutdown complete');
    console.log(`[WebSocketManager] Successfully shutdown ${totalConnections} connection(s)`);
    console.log(`[WebSocketManager] Remaining connections: ${this.connections.size}`);
  }

  /**
   * Get the number of active connections
   * 
   * @returns Number of active WebSocket connections
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get all connected launchpad addresses
   * 
   * @returns Array of launchpad addresses with active connections
   */
  getConnectedAddresses(): string[] {
    return Array.from(this.connections.keys());
  }
}
