import { ethers } from 'ethers';

/**
 * WebSocket Connection Pool
 * Manages multiple WebSocket connections to support unlimited launchpads
 * Each connection handles up to 180 launchpads (safety margin from 200 limit)
 * 
 * Architecture:
 * - Connection 1: Launchpad 1-180 (180 subscriptions)
 * - Connection 2: Launchpad 181-360 (180 subscriptions)
 * - Connection N: Auto-scales as needed
 */

interface ConnectionStats {
  connectionId: number;
  launchpadCount: number;
  createdAt: Date;
  lastEventAt: Date;
  status: ConnectionStatus;
  reconnectCount: number;
}

type ConnectionStatus = 'active' | 'closed' | 'error' | 'failed';

interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  totalLaunchpads: number;
  maxCapacity: number;
  utilizationPercent: number;
  connections: ConnectionStats[];
}

export class WebSocketConnectionPool {
  private connections: Map<number, ethers.WebSocketProvider> = new Map();
  private launchpadToConnection: Map<string, number> = new Map();
  private connectionStats: Map<number, ConnectionStats> = new Map();
  private rpcUrl: string;
  private chainId: number;
  
  // Store contracts with their pooled providers
  private pooledContracts: Map<string, ethers.Contract> = new Map();
  
  // Configuration
  // Reduced from 180 to account for multiple event types per launchpad
  // Each launchpad can have ~20 event types, so 10 launchpads = ~200 subscriptions
  private readonly MAX_LAUNCHPADS_PER_CONNECTION = 180; // Conservative limit to avoid 200 subscription limit
  private readonly CONNECTION_TIMEOUT_MS = 30000;
  private readonly RECONNECT_DELAY_MS = 5000;
  
  constructor(rpcUrl: string, chainId: number) {
    this.rpcUrl = rpcUrl;
    this.chainId = chainId;
    
    console.log(`🏊 WebSocket Connection Pool initialized for chain ${chainId}`);
    console.log(`   └─ Max launchpads per connection: ${this.MAX_LAUNCHPADS_PER_CONNECTION}`);
    console.log(`   └─ Note: Each launchpad has ~20 event subscriptions, so 10 launchpads = ~200 subscriptions (at limit)`);
  }
  
  /**
   * Get or create a WebSocket connection for a launchpad
   * Automatically load balances across connections
   */
  getConnectionForLaunchpad(launchpadAddress: string): {
    provider: ethers.WebSocketProvider;
    connectionId: number;
  } {
    const normalized = launchpadAddress.toLowerCase();
    
    // Check if launchpad already assigned to a connection
    if (this.launchpadToConnection.has(normalized)) {
      const connId = this.launchpadToConnection.get(normalized)!;
      const provider = this.connections.get(connId);
      
      if (provider) {
        return { provider, connectionId: connId };
      } else {
        // Connection was removed, need to reassign
        this.launchpadToConnection.delete(normalized);
      }
    }
    
    // Find connection with available capacity
    for (const [connId, provider] of this.connections) {
      const launchpadCount = this.getLaunchpadCountForConnection(connId);
      
      if (launchpadCount < this.MAX_LAUNCHPADS_PER_CONNECTION) {
        this.launchpadToConnection.set(normalized, connId);
        this.updateConnectionStats(connId, launchpadCount + 1);
        
        console.log(`📍 Assigned launchpad ${normalized.slice(0, 10)}... to connection #${connId} (${launchpadCount + 1}/${this.MAX_LAUNCHPADS_PER_CONNECTION})`);
        return { provider, connectionId: connId };
      }
    }
    
    // All connections are full, create new one
    return this.createNewConnection(normalized);
  }
  
  /**
   * Create a new WebSocket connection
   */
  private createNewConnection(launchpadAddress: string): {
    provider: ethers.WebSocketProvider;
    connectionId: number;
  } {
    const newConnId = this.connections.size;
    const newProvider = new ethers.WebSocketProvider(this.rpcUrl);
    
    this.connections.set(newConnId, newProvider);
    this.launchpadToConnection.set(launchpadAddress, newConnId);
    this.connectionStats.set(newConnId, {
      connectionId: newConnId,
      launchpadCount: 1,
      createdAt: new Date(),
      lastEventAt: new Date(),
      status: 'active',
      reconnectCount: 0
    });
    
    // Setup connection error handling
    this.setupConnectionErrorHandling(newConnId, newProvider);
    
    console.log(`🔌 Created new WebSocket connection #${newConnId} for chain ${this.chainId}`);
    console.log(`   └─ Total connections: ${this.connections.size}`);
    
    return { provider: newProvider, connectionId: newConnId };
  }
  
  /**
   * Create a contract with a pooled provider
   * This is the main method for integrating with ActivityListener
   */
  createPooledContract(
    launchpadAddress: string,
    abi: ethers.InterfaceAbi
  ): { contract: ethers.Contract; connectionId: number } {
    const normalized = launchpadAddress.toLowerCase();
    
    // Check if already created
    if (this.pooledContracts.has(normalized)) {
      const contract = this.pooledContracts.get(normalized)!;
      const connectionId = this.launchpadToConnection.get(normalized)!;
      return { contract, connectionId };
    }
    
    // Get or create connection for this launchpad
    const { provider, connectionId } = this.getConnectionForLaunchpad(normalized);
    
    // Create contract with pooled provider
    const contract = new ethers.Contract(normalized, abi, provider);
    this.pooledContracts.set(normalized, contract);
    
    return { contract, connectionId };
  }
  
  /**
   * Get all pooled contracts as a Map (compatible with existing code)
   */
  getPooledContracts(): Map<string, ethers.Contract> {
    return this.pooledContracts;
  }
  
  /**
   * Initialize multiple launchpads at once with pooling
   * Returns Map of address -> contract for backward compatibility
   */
  initializeLaunchpads(
    addresses: string[],
    abi: ethers.InterfaceAbi
  ): Map<string, ethers.Contract> {
    console.log(`🏊 Initializing ${addresses.length} launchpads with connection pooling...`);
    
    const contracts = new Map<string, ethers.Contract>();
    
    for (const address of addresses) {
      if (!ethers.isAddress(address)) {
        console.warn(`⚠️ Skipping invalid address: ${address}`);
        continue;
      }
      
      const { contract } = this.createPooledContract(address, abi);
      contracts.set(address.toLowerCase(), contract);
    }
    
    // Log pool stats
    const stats = this.getStats();
    console.log(`✅ Pool initialized:`);
    console.log(`   └─ Total connections: ${stats.totalConnections}`);
    console.log(`   └─ Total launchpads: ${stats.totalLaunchpads}`);
    console.log(`   └─ Max capacity: ${stats.maxCapacity}`);
    console.log(`   └─ Utilization: ${stats.utilizationPercent.toFixed(1)}%`);
    
    return contracts;
  }
  
  /**
   * Setup error handling for a connection
   */
  private setupConnectionErrorHandling(connId: number, provider: ethers.WebSocketProvider): void {
    try {
      const ws = (provider as any)._websocket || (provider as any).websocket;
      if (ws) {
        // Log raw WebSocket messages for debugging
        ws.on('message', (data: any) => {
          try {
            const message = data.toString();
            const parsed = JSON.parse(message);
            
            // Only log subscription notifications (not responses to our requests)
            if (parsed.method === 'eth_subscription' && parsed.params) {
              console.log(`📨 [WS-${connId}] Subscription notification received:`);
              console.log(`   └─ Subscription: ${parsed.params.subscription}`);
              console.log(`   └─ Result:`, JSON.stringify(parsed.params.result).substring(0, 200));
            }
          } catch (error) {
            // Ignore parse errors
          }
        });
        
        ws.on('error', (error: any) => {
          console.error(`❌ WebSocket error on connection #${connId}:`, error?.message || error);
          this.updateConnectionStatus(connId, 'error');
        });
        
        ws.on('close', (code: number) => {
          console.warn(`⚠️ WebSocket connection #${connId} closed with code ${code}`);
          this.updateConnectionStatus(connId, 'closed');
          
          // Auto-reconnect after delay
          setTimeout(() => {
            this.reconnectConnection(connId);
          }, this.RECONNECT_DELAY_MS);
        });
      }
    } catch (error) {
      console.warn(`⚠️ Could not setup error handling for connection #${connId}`);
    }
  }
  
  /**
   * Reconnect a closed connection and recreate contracts
   */
  private async reconnectConnection(connId: number): Promise<void> {
    const stats = this.connectionStats.get(connId);
    if (!stats) return;
    
    console.log(`🔄 Reconnecting WebSocket connection #${connId}...`);
    
    try {
      // Create new provider
      const newProvider = new ethers.WebSocketProvider(this.rpcUrl);
      this.connections.set(connId, newProvider);
      
      // Recreate contracts for this connection
      for (const [address, currentConnId] of this.launchpadToConnection) {
        if (currentConnId === connId) {
          const existingContract = this.pooledContracts.get(address);
          if (existingContract) {
            const newContract = new ethers.Contract(
              address,
              existingContract.interface,
              newProvider
            );
            this.pooledContracts.set(address, newContract);
          }
        }
      }
      
      // Update stats
      stats.status = 'active';
      stats.reconnectCount++;
      stats.lastEventAt = new Date();
      
      // Setup error handling
      this.setupConnectionErrorHandling(connId, newProvider);
      
      console.log(`✅ Connection #${connId} reconnected (reconnect count: ${stats.reconnectCount})`);
      
    } catch (error) {
      console.error(`❌ Failed to reconnect connection #${connId}:`, error);
      stats.status = 'failed';
    }
  }
  
  /**
   * Mark connection as active (received event)
   */
  markConnectionActive(connId: number): void {
    const stats = this.connectionStats.get(connId);
    if (stats) {
      stats.lastEventAt = new Date();
      stats.status = 'active';
    }
  }
  
  /**
   * Get launchpad count for a specific connection
   */
  private getLaunchpadCountForConnection(connId: number): number {
    return Array.from(this.launchpadToConnection.values())
      .filter(id => id === connId).length;
  }
  
  /**
   * Update connection statistics
   */
  private updateConnectionStats(connId: number, launchpadCount: number): void {
    const stats = this.connectionStats.get(connId);
    if (stats) {
      stats.launchpadCount = launchpadCount;
      stats.lastEventAt = new Date();
    }
  }
  
  /**
   * Update connection status
   */
  private updateConnectionStatus(connId: number, status: ConnectionStatus): void {
    const stats = this.connectionStats.get(connId);
    if (stats) {
      stats.status = status;
    }
  }
  
  /**
   * Remove a launchpad from the pool
   */
  removeLaunchpad(launchpadAddress: string): void {
    const normalized = launchpadAddress.toLowerCase();
    const connId = this.launchpadToConnection.get(normalized);
    
    // Remove contract
    this.pooledContracts.delete(normalized);
    
    if (connId !== undefined) {
      this.launchpadToConnection.delete(normalized);
      const newCount = this.getLaunchpadCountForConnection(connId);
      this.updateConnectionStats(connId, newCount);
      
      console.log(`📍 Removed launchpad ${normalized.slice(0, 10)}... from connection #${connId} (${newCount}/${this.MAX_LAUNCHPADS_PER_CONNECTION})`);
      
      // If connection is empty, consider closing it
      if (newCount === 0) {
        this.closeConnection(connId);
      }
    }
  }
  
  /**
   * Close a connection
   */
  private async closeConnection(connId: number): Promise<void> {
    const provider = this.connections.get(connId);
    if (provider) {
      try {
        await provider.destroy();
        this.connections.delete(connId);
        this.connectionStats.delete(connId);
        console.log(`🔌 Closed WebSocket connection #${connId} (no launchpads)`);
      } catch (error) {
        console.error(`❌ Error closing connection #${connId}:`, error);
      }
    }
  }
  
  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const connections = Array.from(this.connectionStats.values());
    const totalLaunchpads = this.launchpadToConnection.size;
    const activeConnections = connections.filter(c => c.status === 'active').length;
    const maxCapacity = this.connections.size * this.MAX_LAUNCHPADS_PER_CONNECTION;
    
    return {
      totalConnections: this.connections.size,
      activeConnections,
      totalLaunchpads,
      maxCapacity,
      utilizationPercent: maxCapacity > 0 ? (totalLaunchpads / maxCapacity) * 100 : 0,
      connections
    };
  }
  
  /**
   * Cleanup all connections
   */
  async destroy(): Promise<void> {
    console.log(`🧹 Destroying WebSocket connection pool for chain ${this.chainId}...`);
    
    for (const [connId, provider] of this.connections) {
      try {
        await provider.destroy();
        console.log(`   └─ Closed connection #${connId}`);
      } catch (error) {
        console.error(`   └─ Error closing connection #${connId}:`, error);
      }
    }
    
    this.connections.clear();
    this.launchpadToConnection.clear();
    this.connectionStats.clear();
    this.pooledContracts.clear();
    
    console.log(`✅ Connection pool destroyed`);
  }
}
