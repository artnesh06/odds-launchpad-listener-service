/**
 * Unit tests for WebSocketManager class structure
 * 
 * Tests the basic structure and interfaces of the WebSocketManager class
 * created in task 4.1. Full implementation tests will be added in later tasks.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { WebSocketManager, ConnectionStatus } from '../websocket-manager';
import { EventProcessor } from '../../processors/event-processor';
import { prisma } from '../../../config/database';

describe('WebSocketManager - Task 4.1 Structure', () => {
  let mockProvider: ethers.providers.WebSocketProvider;
  let eventProcessor: EventProcessor;
  let manager: WebSocketManager;

  beforeEach(() => {
    // Create mock WebSocket provider
    // Note: This is a minimal mock for structure testing
    mockProvider = {
      on: () => {},
      removeAllListeners: () => {},
    } as any;

    // Create event processor instance
    eventProcessor = new EventProcessor();

    // Create WebSocketManager instance
    manager = new WebSocketManager(mockProvider, eventProcessor);
  });

  describe('Constructor', () => {
    it('should create WebSocketManager with provider and event processor', () => {
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(WebSocketManager);
    });

    it('should initialize with empty connections', () => {
      expect(manager.getActiveConnectionCount()).toBe(0);
      expect(manager.getConnectedAddresses()).toEqual([]);
    });
  });

  describe('ConnectionStatus Interface', () => {
    it('should return proper connection status for non-existent connection', () => {
      const status = manager.getConnectionStatus('0x1234567890123456789012345678901234567890');
      
      expect(status).toBeDefined();
      expect(status.isConnected).toBe(false);
      expect(status.launchpadAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(status.reconnectAttempts).toBe(0);
      expect(status.connectedAt).toBeUndefined();
      expect(status.lastError).toBeUndefined();
    });

    it('should have correct ConnectionStatus interface structure', () => {
      const status: ConnectionStatus = {
        isConnected: true,
        launchpadAddress: '0x1234567890123456789012345678901234567890',
        connectedAt: new Date(),
        lastError: new Error('test'),
        reconnectAttempts: 0
      };

      expect(status.isConnected).toBe(true);
      expect(status.launchpadAddress).toBeDefined();
      expect(status.connectedAt).toBeInstanceOf(Date);
      expect(status.lastError).toBeInstanceOf(Error);
      expect(status.reconnectAttempts).toBe(0);
    });
  });

  describe('Method Signatures', () => {
    it('should have initialize method', () => {
      expect(typeof manager.initialize).toBe('function');
    });

    it('should have addListener method', () => {
      expect(typeof manager.addListener).toBe('function');
    });

    it('should have removeListener method', () => {
      expect(typeof manager.removeListener).toBe('function');
    });

    it('should have getConnectionStatus method', () => {
      expect(typeof manager.getConnectionStatus).toBe('function');
    });

    it('should have shutdown method', () => {
      expect(typeof manager.shutdown).toBe('function');
    });

    it('should have getActiveConnectionCount method', () => {
      expect(typeof manager.getActiveConnectionCount).toBe('function');
    });

    it('should have getConnectedAddresses method', () => {
      expect(typeof manager.getConnectedAddresses).toBe('function');
    });
  });

  describe('Helper Methods', () => {
    it('should return 0 for active connection count initially', () => {
      expect(manager.getActiveConnectionCount()).toBe(0);
    });

    it('should return empty array for connected addresses initially', () => {
      const addresses = manager.getConnectedAddresses();
      expect(Array.isArray(addresses)).toBe(true);
      expect(addresses.length).toBe(0);
    });
  });

  describe('Async Method Returns', () => {
    it('initialize should return a Promise', async () => {
      const result = manager.initialize();
      expect(result).toBeInstanceOf(Promise);
      await result; // Should not throw
    });

    it('addListener should return a Promise', async () => {
      const result = manager.addListener('0x1234567890123456789012345678901234567890');
      expect(result).toBeInstanceOf(Promise);
      await result; // Should not throw
    });

    it('removeListener should return a Promise', async () => {
      const result = manager.removeListener('0x1234567890123456789012345678901234567890');
      expect(result).toBeInstanceOf(Promise);
      await result; // Should not throw
    });

    it('shutdown should return a Promise', async () => {
      const result = manager.shutdown();
      expect(result).toBeInstanceOf(Promise);
      await result; // Should not throw
    });
  });
});

describe('WebSocketManager - Task 4.3 removeListener Implementation', () => {
  let mockProvider: any;
  let eventProcessor: EventProcessor;
  let manager: WebSocketManager;
  let mockContract: any;
  let contractOnSpy: any;
  let contractOffSpy: any;
  let providerOnSpy: any;
  let contractSpy: any;

  beforeEach(() => {
    // Restore all mocks before each test
    vi.restoreAllMocks();

    // Create spies for tracking calls
    contractOnSpy = vi.fn();
    contractOffSpy = vi.fn();
    providerOnSpy = vi.fn();

    // Create mock provider with proper structure
    mockProvider = {
      on: providerOnSpy,
      removeAllListeners: vi.fn(),
      _isProvider: true,
    };

    // Create mock contract with proper structure
    mockContract = {
      on: contractOnSpy,
      off: contractOffSpy,
      removeAllListeners: vi.fn(),
      provider: mockProvider,
      address: '',
      interface: {},
    };

    // Mock ethers.Contract constructor to return our mock
    contractSpy = vi.fn().mockImplementation(function(address: string, abi: any, provider: any) {
      mockContract.address = address;
      return mockContract;
    });
    
    // Replace the Contract constructor
    (ethers as any).Contract = contractSpy;

    // Create event processor instance
    eventProcessor = new EventProcessor();

    // Create WebSocketManager instance
    manager = new WebSocketManager(mockProvider, eventProcessor);
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  describe('removeListener', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';

    it('should remove event listener from contract', async () => {
      // First add a listener
      await manager.addListener(testAddress);
      expect(manager.getActiveConnectionCount()).toBe(1);

      // Then remove it
      await manager.removeListener(testAddress);

      expect(contractOffSpy).toHaveBeenCalledWith('Minted', expect.any(Function));
    });

    it('should clean up connection from connections Map', async () => {
      // First add a listener
      await manager.addListener(testAddress);
      expect(manager.getActiveConnectionCount()).toBe(1);
      expect(manager.getConnectedAddresses()).toContain(testAddress);

      // Then remove it
      await manager.removeListener(testAddress);

      expect(manager.getActiveConnectionCount()).toBe(0);
      expect(manager.getConnectedAddresses()).not.toContain(testAddress);
    });

    it('should update connection status after removal', async () => {
      // First add a listener
      await manager.addListener(testAddress);
      let status = manager.getConnectionStatus(testAddress);
      expect(status.isConnected).toBe(true);

      // Then remove it
      await manager.removeListener(testAddress);

      status = manager.getConnectionStatus(testAddress);
      expect(status.isConnected).toBe(false);
    });

    it('should handle removal of non-existent listener gracefully', async () => {
      // Try to remove a listener that was never added
      await expect(manager.removeListener(testAddress)).resolves.not.toThrow();

      expect(manager.getActiveConnectionCount()).toBe(0);
    });

    it('should only remove the specified listener when multiple exist', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const address3 = '0x3333333333333333333333333333333333333333';

      // Add multiple listeners
      await manager.addListener(address1);
      await manager.addListener(address2);
      await manager.addListener(address3);
      expect(manager.getActiveConnectionCount()).toBe(3);

      // Remove only one
      await manager.removeListener(address2);

      expect(manager.getActiveConnectionCount()).toBe(2);
      expect(manager.getConnectedAddresses()).toContain(address1);
      expect(manager.getConnectedAddresses()).not.toContain(address2);
      expect(manager.getConnectedAddresses()).toContain(address3);
    });

    it('should handle errors during listener removal', async () => {
      // First add a listener
      await manager.addListener(testAddress);

      // Make contract.off throw an error
      contractOffSpy.mockImplementation(() => {
        throw new Error('Failed to remove listener');
      });

      await expect(manager.removeListener(testAddress)).rejects.toThrow('Failed to remove listener');
    });

    it('should allow re-adding listener after removal', async () => {
      // Add listener
      await manager.addListener(testAddress);
      expect(manager.getActiveConnectionCount()).toBe(1);

      // Remove listener
      await manager.removeListener(testAddress);
      expect(manager.getActiveConnectionCount()).toBe(0);

      // Add listener again
      await manager.addListener(testAddress);
      expect(manager.getActiveConnectionCount()).toBe(1);
      expect(manager.getConnectedAddresses()).toContain(testAddress);
    });

    it('should log connection removal', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      // Add and then remove listener
      await manager.addListener(testAddress);
      await manager.removeListener(testAddress);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] Removing listener for launchpad:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] Successfully removed listener')
      );
    });
  });
});

describe('WebSocketManager - Task 4.2 addListener Implementation', () => {
  let mockProvider: any;
  let eventProcessor: EventProcessor;
  let manager: WebSocketManager;
  let mockContract: any;
  let contractOnSpy: any;
  let providerOnSpy: any;
  let contractSpy: any;

  beforeEach(() => {
    // Restore all mocks before each test
    vi.restoreAllMocks();

    // Create spies for tracking calls
    contractOnSpy = vi.fn();
    providerOnSpy = vi.fn();

    // Create mock provider with proper structure
    mockProvider = {
      on: providerOnSpy,
      removeAllListeners: vi.fn(),
      _isProvider: true,
    };

    // Create mock contract with proper structure
    mockContract = {
      on: contractOnSpy,
      off: vi.fn(),
      removeAllListeners: vi.fn(),
      provider: mockProvider,
      address: '',
      interface: {},
    };

    // Mock ethers.Contract constructor to return our mock
    contractSpy = vi.fn().mockImplementation(function(address: string, abi: any, provider: any) {
      mockContract.address = address;
      return mockContract;
    });
    
    // Replace the Contract constructor
    (ethers as any).Contract = contractSpy;

    // Create event processor instance
    eventProcessor = new EventProcessor();

    // Create WebSocketManager instance
    manager = new WebSocketManager(mockProvider, eventProcessor);
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  describe('addListener', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';

    it('should create a contract instance with correct parameters', async () => {
      await manager.addListener(testAddress);

      expect(contractSpy).toHaveBeenCalledWith(
        testAddress,
        expect.any(Array), // ABI
        mockProvider
      );
    });

    it('should register Minted event listener on the contract', async () => {
      await manager.addListener(testAddress);

      expect(contractOnSpy).toHaveBeenCalledWith('Minted', expect.any(Function));
    });

    it('should store connection in connections Map', async () => {
      await manager.addListener(testAddress);

      expect(manager.getActiveConnectionCount()).toBe(1);
      expect(manager.getConnectedAddresses()).toContain(testAddress);
    });

    it('should setup error handling on provider', async () => {
      await manager.addListener(testAddress);

      expect(providerOnSpy).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should update connection status after adding listener', async () => {
      await manager.addListener(testAddress);

      const status = manager.getConnectionStatus(testAddress);
      expect(status.isConnected).toBe(true);
      expect(status.launchpadAddress).toBe(testAddress);
      expect(status.connectedAt).toBeInstanceOf(Date);
      expect(status.reconnectAttempts).toBe(0);
    });

    it('should not add duplicate listener for same address', async () => {
      await manager.addListener(testAddress);
      await manager.addListener(testAddress);

      expect(manager.getActiveConnectionCount()).toBe(1);
      expect(contractSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple different addresses', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';

      await manager.addListener(address1);
      await manager.addListener(address2);

      expect(manager.getActiveConnectionCount()).toBe(2);
      expect(manager.getConnectedAddresses()).toContain(address1);
      expect(manager.getConnectedAddresses()).toContain(address2);
    });

    it('should throw error if contract creation fails', async () => {
      contractSpy.mockImplementation(() => {
        throw new Error('Contract creation failed');
      });

      await expect(manager.addListener(testAddress)).rejects.toThrow('Contract creation failed');
    });

    it('should process mint events through EventProcessor', async () => {
      const processSpy = vi.spyOn(eventProcessor, 'processMintEvent');

      await manager.addListener(testAddress);

      // Get the listener function that was registered
      const listenerCall = contractOnSpy.mock.calls.find(
        (call: any[]) => call[0] === 'Minted'
      );
      expect(listenerCall).toBeDefined();

      const listener = listenerCall[1];

      // Simulate a Minted event
      const mockEvent = {
        transactionHash: '0xabcdef',
        blockNumber: 12345,
        logIndex: 0
      };

      await listener(
        '0xrecipient',
        ethers.BigNumber.from(1),
        ethers.BigNumber.from(0),
        ethers.BigNumber.from(1),
        mockEvent
      );

      expect(processSpy).toHaveBeenCalledWith({
        from: '0xrecipient',
        tokenId: '1',
        transactionHash: '0xabcdef',
        logIndex: 0,
        blockNumber: 12345,
        launchpadAddress: testAddress,
        source: 'websocket'
      });
    });
  });

  describe('Error Handling', () => {
    const testAddress = '0x1234567890123456789012345678901234567890';

    it('should update connection status when provider error occurs', async () => {
      await manager.addListener(testAddress);

      // Get the error handler that was registered
      const errorHandlerCall = providerOnSpy.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      );
      expect(errorHandlerCall).toBeDefined();

      const errorHandler = errorHandlerCall[1];
      const testError = new Error('Connection lost');

      // Trigger the error handler
      errorHandler(testError);

      const status = manager.getConnectionStatus(testAddress);
      expect(status.lastError).toBe(testError);
    });
  });
});

describe('WebSocketManager - Task 4.4 initialize Implementation', () => {
  let mockProvider: any;
  let eventProcessor: EventProcessor;
  let manager: WebSocketManager;
  let mockContract: any;
  let contractOnSpy: any;
  let providerOnSpy: any;
  let contractSpy: any;

  beforeEach(() => {
    // Restore all mocks before each test
    vi.restoreAllMocks();

    // Create spies for tracking calls
    contractOnSpy = vi.fn();
    providerOnSpy = vi.fn();

    // Create mock provider with proper structure
    mockProvider = {
      on: providerOnSpy,
      removeAllListeners: vi.fn(),
      _isProvider: true,
    };

    // Create mock contract with proper structure
    mockContract = {
      on: contractOnSpy,
      off: vi.fn(),
      removeAllListeners: vi.fn(),
      provider: mockProvider,
      address: '',
      interface: {},
    };

    // Mock ethers.Contract constructor to return our mock
    contractSpy = vi.fn().mockImplementation(function(address: string, abi: any, provider: any) {
      mockContract.address = address;
      return mockContract;
    });
    
    // Replace the Contract constructor
    (ethers as any).Contract = contractSpy;

    // Create event processor instance
    eventProcessor = new EventProcessor();

    // Create WebSocketManager instance
    manager = new WebSocketManager(mockProvider, eventProcessor);
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should query database for featured launchpads', async () => {
      // Mock prisma.launchpad.findMany
      const findManySpy = vi.spyOn(prisma.launchpad, 'findMany').mockResolvedValue([]);

      await manager.initialize();

      expect(findManySpy).toHaveBeenCalledWith({
        where: { isFeatured: true },
        select: {
          id: true,
          contractAddress: true,
          name: true
        }
      });
    });

    it('should call addListener for each featured launchpad', async () => {
      const mockLaunchpads = [
        { id: '1', contractAddress: '0x1111111111111111111111111111111111111111', name: 'Launchpad 1' },
        { id: '2', contractAddress: '0x2222222222222222222222222222222222222222', name: 'Launchpad 2' },
        { id: '3', contractAddress: '0x3333333333333333333333333333333333333333', name: 'Launchpad 3' }
      ];

      vi.spyOn(prisma.launchpad, 'findMany').mockResolvedValue(mockLaunchpads as any);

      await manager.initialize();

      expect(manager.getActiveConnectionCount()).toBe(3);
      expect(manager.getConnectedAddresses()).toContain(mockLaunchpads[0].contractAddress);
      expect(manager.getConnectedAddresses()).toContain(mockLaunchpads[1].contractAddress);
      expect(manager.getConnectedAddresses()).toContain(mockLaunchpads[2].contractAddress);
    });

    it('should log initialization status', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const mockLaunchpads = [
        { id: '1', contractAddress: '0x1111111111111111111111111111111111111111', name: 'Launchpad 1' }
      ];

      vi.spyOn(prisma.launchpad, 'findMany').mockResolvedValue(mockLaunchpads as any);

      await manager.initialize();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] Initializing WebSocket connections')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] Found 1 featured launchpad(s)')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] Initialization complete')
      );
    });

    it('should handle empty featured launchpads list', async () => {
      vi.spyOn(prisma.launchpad, 'findMany').mockResolvedValue([]);

      await manager.initialize();

      expect(manager.getActiveConnectionCount()).toBe(0);
      expect(manager.getConnectedAddresses()).toEqual([]);
    });

    it('should continue with other launchpads if one fails', async () => {
      const mockLaunchpads = [
        { id: '1', contractAddress: '0x1111111111111111111111111111111111111111', name: 'Launchpad 1' },
        { id: '2', contractAddress: '0x2222222222222222222222222222222222222222', name: 'Launchpad 2' },
        { id: '3', contractAddress: '0x3333333333333333333333333333333333333333', name: 'Launchpad 3' }
      ];

      vi.spyOn(prisma.launchpad, 'findMany').mockResolvedValue(mockLaunchpads as any);

      // Make the second contract creation fail
      let callCount = 0;
      contractSpy.mockImplementation(function(address: string, abi: any, provider: any) {
        callCount++;
        if (callCount === 2) {
          throw new Error('Contract creation failed');
        }
        mockContract.address = address;
        return mockContract;
      });

      await manager.initialize();

      // Should have 2 successful connections (1st and 3rd)
      expect(manager.getActiveConnectionCount()).toBe(2);
    });

    it('should log successful and failed connections', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const consoleErrorSpy = vi.spyOn(console, 'error');
      const mockLaunchpads = [
        { id: '1', contractAddress: '0x1111111111111111111111111111111111111111', name: 'Launchpad 1' },
        { id: '2', contractAddress: '0x2222222222222222222222222222222222222222', name: 'Launchpad 2' }
      ];

      vi.spyOn(prisma.launchpad, 'findMany').mockResolvedValue(mockLaunchpads as any);

      // Make the second contract creation fail
      let callCount = 0;
      contractSpy.mockImplementation(function(address: string, abi: any, provider: any) {
        callCount++;
        if (callCount === 2) {
          throw new Error('Contract creation failed');
        }
        mockContract.address = address;
        return mockContract;
      });

      await manager.initialize();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successful connections: 1')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed connections: 1')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] ✗ Failed to connect to launchpad'),
        expect.any(Error)
      );
    });

    it('should throw error if database query fails', async () => {
      const dbError = new Error('Database connection failed');
      vi.spyOn(prisma.launchpad, 'findMany').mockRejectedValue(dbError);

      await expect(manager.initialize()).rejects.toThrow('Database connection failed');
    });

    it('should establish connections in parallel', async () => {
      const mockLaunchpads = [
        { id: '1', contractAddress: '0x1111111111111111111111111111111111111111', name: 'Launchpad 1' },
        { id: '2', contractAddress: '0x2222222222222222222222222222222222222222', name: 'Launchpad 2' },
        { id: '3', contractAddress: '0x3333333333333333333333333333333333333333', name: 'Launchpad 3' }
      ];

      vi.spyOn(prisma.launchpad, 'findMany').mockResolvedValue(mockLaunchpads as any);

      const startTime = Date.now();
      await manager.initialize();
      const endTime = Date.now();

      // All connections should be established
      expect(manager.getActiveConnectionCount()).toBe(3);

      // Execution should be fast (parallel, not sequential)
      // If it were sequential with delays, it would take much longer
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});

describe('WebSocketManager - Task 6.4 shutdown Implementation', () => {
  let mockProvider: any;
  let eventProcessor: EventProcessor;
  let manager: WebSocketManager;
  let mockContract: any;
  let contractOnSpy: any;
  let contractOffSpy: any;
  let providerOnSpy: any;
  let contractSpy: any;

  beforeEach(() => {
    // Restore all mocks before each test
    vi.restoreAllMocks();

    // Create spies for tracking calls
    contractOnSpy = vi.fn();
    contractOffSpy = vi.fn();
    providerOnSpy = vi.fn();

    // Create mock provider with proper structure
    mockProvider = {
      on: providerOnSpy,
      removeAllListeners: vi.fn(),
      _isProvider: true,
    };

    // Create mock contract with proper structure
    mockContract = {
      on: contractOnSpy,
      off: contractOffSpy,
      removeAllListeners: vi.fn(),
      provider: mockProvider,
      address: '',
      interface: {},
    };

    // Mock ethers.Contract constructor to return our mock
    contractSpy = vi.fn().mockImplementation(function(address: string, abi: any, provider: any) {
      mockContract.address = address;
      return mockContract;
    });
    
    // Replace the Contract constructor
    (ethers as any).Contract = contractSpy;

    // Create event processor instance
    eventProcessor = new EventProcessor();

    // Create WebSocketManager instance
    manager = new WebSocketManager(mockProvider, eventProcessor);
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  describe('shutdown', () => {
    it('should handle shutdown with no active connections', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await manager.shutdown();

      expect(manager.getActiveConnectionCount()).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] No active connections to shutdown')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] ✅ Shutdown complete')
      );
    });

    it('should iterate through all connections and call removeListener', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const address3 = '0x3333333333333333333333333333333333333333';

      // Add multiple listeners
      await manager.addListener(address1);
      await manager.addListener(address2);
      await manager.addListener(address3);
      expect(manager.getActiveConnectionCount()).toBe(3);

      // Shutdown all connections
      await manager.shutdown();

      // All connections should be removed
      expect(manager.getActiveConnectionCount()).toBe(0);
      expect(contractOffSpy).toHaveBeenCalledTimes(3);
    });

    it('should clear connections Map after shutdown', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';

      // Add listeners
      await manager.addListener(address1);
      await manager.addListener(address2);
      expect(manager.getActiveConnectionCount()).toBe(2);

      // Shutdown
      await manager.shutdown();

      // Connections Map should be empty
      expect(manager.getActiveConnectionCount()).toBe(0);
      expect(manager.getConnectedAddresses()).toEqual([]);
    });

    it('should log shutdown completion', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const address1 = '0x1111111111111111111111111111111111111111';

      await manager.addListener(address1);
      await manager.shutdown();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] Shutting down all WebSocket connections')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] ✅ Shutdown complete')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully shutdown 1 connection(s)')
      );
    });

    it('should continue shutdown even if one connection fails', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const address3 = '0x3333333333333333333333333333333333333333';

      // Add multiple listeners
      await manager.addListener(address1);
      await manager.addListener(address2);
      await manager.addListener(address3);
      expect(manager.getActiveConnectionCount()).toBe(3);

      // Make the second removeListener call fail
      let offCallCount = 0;
      contractOffSpy.mockImplementation(() => {
        offCallCount++;
        if (offCallCount === 2) {
          throw new Error('Failed to remove listener');
        }
      });

      // Shutdown should not throw and should continue with other connections
      await expect(manager.shutdown()).resolves.not.toThrow();

      // All connections should still be cleared from the Map
      expect(manager.getActiveConnectionCount()).toBe(0);
    });

    it('should log errors for failed connection shutdowns', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');
      const address1 = '0x1111111111111111111111111111111111111111';

      await manager.addListener(address1);

      // Make removeListener fail
      contractOffSpy.mockImplementation(() => {
        throw new Error('Failed to remove listener');
      });

      await manager.shutdown();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WebSocketManager] ✗ Error shutting down connection'),
        expect.any(Error)
      );
    });

    it('should shutdown all connections in parallel', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';
      const address3 = '0x3333333333333333333333333333333333333333';

      // Add multiple listeners
      await manager.addListener(address1);
      await manager.addListener(address2);
      await manager.addListener(address3);

      const startTime = Date.now();
      await manager.shutdown();
      const endTime = Date.now();

      // All connections should be removed
      expect(manager.getActiveConnectionCount()).toBe(0);

      // Execution should be fast (parallel, not sequential)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should log remaining connections count after shutdown', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';

      await manager.addListener(address1);
      await manager.addListener(address2);
      await manager.shutdown();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Remaining connections: 0')
      );
    });

    it('should allow re-initialization after shutdown', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';

      // Add listener
      await manager.addListener(address1);
      expect(manager.getActiveConnectionCount()).toBe(1);

      // Shutdown
      await manager.shutdown();
      expect(manager.getActiveConnectionCount()).toBe(0);

      // Add listener again
      await manager.addListener(address1);
      expect(manager.getActiveConnectionCount()).toBe(1);
      expect(manager.getConnectedAddresses()).toContain(address1);
    });

    it('should update connection status for all addresses after shutdown', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';
      const address2 = '0x2222222222222222222222222222222222222222';

      // Add listeners
      await manager.addListener(address1);
      await manager.addListener(address2);

      // Verify connections are active
      expect(manager.getConnectionStatus(address1).isConnected).toBe(true);
      expect(manager.getConnectionStatus(address2).isConnected).toBe(true);

      // Shutdown
      await manager.shutdown();

      // Verify connections are inactive
      expect(manager.getConnectionStatus(address1).isConnected).toBe(false);
      expect(manager.getConnectionStatus(address2).isConnected).toBe(false);
    });

    it('should handle multiple shutdown calls gracefully', async () => {
      const address1 = '0x1111111111111111111111111111111111111111';

      await manager.addListener(address1);
      
      // First shutdown
      await manager.shutdown();
      expect(manager.getActiveConnectionCount()).toBe(0);

      // Second shutdown should not throw
      await expect(manager.shutdown()).resolves.not.toThrow();
      expect(manager.getActiveConnectionCount()).toBe(0);
    });
  });
});
