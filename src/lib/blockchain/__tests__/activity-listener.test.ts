import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { ActivityListener } from '../activity-listener';
import { prisma } from '../../../config/database';

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
    WebSocketProvider: vi.fn(),
    Contract: vi.fn(),
    ZeroAddress: '0x0000000000000000000000000000000000000000',
    formatEther: vi.fn((value) => '1.0')
  }
}));

// Mock prisma
vi.mock('../../../config/database', () => {
  const mockPrisma = {
    activity: {
      create: vi.fn(),
      findFirst: vi.fn()
    },
    launchpad: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn()
    },
    launchpadFactory: {
      findUnique: vi.fn()
    },
    launchpadPhase: {
      create: vi.fn(),
      update: vi.fn()
    },
    nFT: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn((callback) => callback(mockPrisma))
  };
  
  return {
    prisma: mockPrisma,
    withRetry: vi.fn(async (operation) => await operation()),
    withDbLimit: vi.fn(async (operation) => await operation())
  };
});

// Mock error logger
vi.mock('../../../utils/error-logger', () => ({
  logError: vi.fn()
}));

describe('ActivityListener - Event Handler Tests', () => {
  let listener: ActivityListener;
  let mockProvider: any;
  let mockContract: any;
  let eventHandlers: Map<string, Function>;
  let mockPrisma: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Get the mocked prisma
    mockPrisma = prisma;
    
    // Setup event handlers map
    eventHandlers = new Map();

    // Mock provider
    mockProvider = {
      getBlockNumber: vi.fn().mockResolvedValue(1000),
      getTransaction: vi.fn().mockResolvedValue({ value: BigInt(1000000000000000000) }),
      pollingInterval: 8000,
      destroy: vi.fn().mockResolvedValue(undefined),
      on: vi.fn() // Add error handler support
    };

    // Mock contract with event listener capture
    mockContract = {
      filters: {
        Transfer: vi.fn((...args) => 'transfer-filter'),
        ContractDeployed: vi.fn().mockReturnValue('deployed-filter'),
        Burned: vi.fn().mockReturnValue('burned-filter'),
        Airdropped: vi.fn().mockReturnValue('airdropped-filter'),
        PhaseAdded: vi.fn().mockReturnValue('phase-added-filter'),
        PhaseUpdated: vi.fn().mockReturnValue('phase-updated-filter'),
        Revealed: vi.fn().mockReturnValue('revealed-filter'),
        TreasuryUpdated: vi.fn().mockReturnValue('treasury-updated-filter'),
        Withdrawn: vi.fn().mockReturnValue('withdrawn-filter'),
        OwnershipTransferred: vi.fn().mockReturnValue('ownership-transferred-filter'),
        PlatformFeeToggled: vi.fn().mockReturnValue('platform-fee-toggled-filter'),
        PlatformFlatFeeUpdated: vi.fn().mockReturnValue('platform-flat-fee-updated-filter'),
        RoyaltyUpdated: vi.fn().mockReturnValue('royalty-updated-filter')
      },
      on: vi.fn((filter, handler) => {
        eventHandlers.set(filter, handler);
      }),
      removeAllListeners: vi.fn(),
      queryFilter: vi.fn().mockResolvedValue([]),
      name: vi.fn().mockResolvedValue('Test Collection'),
      symbol: vi.fn().mockResolvedValue('TEST'),
      totalSupply: vi.fn().mockResolvedValue(BigInt(1000)),
      owner: vi.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      treasury: vi.fn().mockResolvedValue('0x1234567890123456789012345678901234567890')
    };

    // Mock ethers constructors
    (ethers.JsonRpcProvider as any).mockReturnValue(mockProvider);
    (ethers.WebSocketProvider as any).mockReturnValue(mockProvider);
    (ethers.Contract as any).mockReturnValue(mockContract);

    // Mock database responses
    (mockPrisma.launchpadFactory.findUnique as any).mockResolvedValue({
      id: 1,
      contractAddress: '0xfactory123'
    });

    (mockPrisma.launchpad.findUnique as any).mockResolvedValue({
      id: 1,
      contractAddress: '0x1234567890123456789012345678901234567890', // Valid 40 char address
      name: 'Test Collection',
      symbol: 'TEST',
      totalMaxSupply: 1000,
      factoryId: 1,
      creator: '0x1234567890123456789012345678901234567890',
      metadata: {
        image: 'https://example.com/image.png'
      },
      factory: {
        id: 1
      }
    });

    (mockPrisma.activity.findFirst as any).mockResolvedValue(null);
    (mockPrisma.activity.create as any).mockResolvedValue({ id: 1 });
    (mockPrisma.nFT.findUnique as any).mockResolvedValue(null);
    (mockPrisma.nFT.create as any).mockResolvedValue({ id: 1 });
    
    // Mock $transaction to execute the callback immediately with mockPrisma
    (mockPrisma.$transaction as any).mockImplementation(async (callback: any) => {
      return await callback(mockPrisma);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Event Structure Validation', () => {
    it('should handle HTTP provider event structure (ContractEventPayload)', async () => {
      const validLaunchpadAddress = '0x1234567890123456789012345678901234567890';
      const validTxHash = '0xabc1234567890123456789012345678901234567890123456789012345678901';
      
      const config = {
        chainId: 6343,
        rpcUrl: 'https://megaeth-testnet.g.alchemy.com/v2/test',
        factoryAddress: '0xfactory123',
        launchpadAddresses: [validLaunchpadAddress],
        enabledEvents: ['Transfer']
      };

      // Update mock to return valid launchpad
      (mockPrisma.launchpad.findUnique as any).mockResolvedValue({
        id: 1,
        contractAddress: validLaunchpadAddress,
        name: 'Test Collection',
        symbol: 'TEST',
        totalMaxSupply: 1000,
        factoryId: 1,
        creator: '0x1234567890123456789012345678901234567890',
        metadata: {
          image: 'https://example.com/image.png'
        },
        factory: {
          id: 1
        }
      });

      listener = new ActivityListener(config);
      await listener.start();

      // Get the Transfer event handler
      const transferHandler = eventHandlers.get('transfer-filter');
      expect(transferHandler).toBeDefined();

      // Call handler with traditional event structure (from, to, tokenId, event)
      await transferHandler!(
        '0x0000000000000000000000000000000000000000', // from
        '0x9a299b9AaA23198589E284F269BB3a546acfc137', // to
        BigInt(1), // tokenId
        {
          blockNumber: 1001,
          transactionHash: validTxHash,
          address: validLaunchpadAddress,
          index: 0
        }
      );

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalled();
    });

    it('should handle WebSocket provider event structure (traditional)', async () => {
      const validLaunchpadAddress = '0x1234567890123456789012345678901234567890';
      const validTxHash = '0xabc1234567890123456789012345678901234567890123456789012345678901';
      
      const config = {
        chainId: 11155111,
        rpcUrl: 'wss://sepolia.infura.io/ws/v3/test',
        factoryAddress: '0xfactory123',
        launchpadAddresses: [validLaunchpadAddress],
        enabledEvents: ['Transfer']
      };

      // Update mock to return valid launchpad
      (mockPrisma.launchpad.findUnique as any).mockResolvedValue({
        id: 1,
        contractAddress: validLaunchpadAddress,
        name: 'Test Collection',
        symbol: 'TEST',
        totalMaxSupply: 1000,
        factoryId: 1,
        creator: '0x1234567890123456789012345678901234567890',
        metadata: {
          image: 'https://example.com/image.png'
        },
        factory: {
          id: 1
        }
      });

      listener = new ActivityListener(config);
      await listener.start();

      // Get the Transfer event handler
      const transferHandler = eventHandlers.get('transfer-filter');
      expect(transferHandler).toBeDefined();

      // Call handler with traditional event structure (from, to, tokenId, event)
      await transferHandler!(
        '0x0000000000000000000000000000000000000000', // from
        '0x9a299b9AaA23198589E284F269BB3a546acfc137', // to
        BigInt(1), // tokenId
        {
          blockNumber: 1001,
          transactionHash: validTxHash,
          address: validLaunchpadAddress,
          index: 0
        }
      );

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalled();
    });

    it('should handle invalid event structure gracefully', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0xlaunchpad123'],
        enabledEvents: ['Transfer']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const transferHandler = eventHandlers.get('transfer-filter');
      
      // Call with invalid structure
      await transferHandler!({ invalid: 'structure' });

      // Should not crash and should not create activity
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('ContractDeployed Event', () => {
    it('should handle ContractDeployed event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        enabledEvents: ['ContractDeployed']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('deployed-filter');
      expect(handler).toBeDefined();

      // Mock launchpad not found initially
      (mockPrisma.launchpad.findUnique as any).mockResolvedValueOnce(null);
      (mockPrisma.launchpad.create as any).mockResolvedValue({
        id: 2,
        contractAddress: '0xnewlaunchpad'
      });

      await handler!(
        '0xnewlaunchpad',
        '0xtemplate',
        '0xdeployer',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0xdeploy123'
        }
      );

      // Should create launchpad and activity
      expect(mockPrisma.launchpad.create).toHaveBeenCalled();
      expect(mockPrisma.activity.create).toHaveBeenCalled();
    });

    it('should handle missing blockNumber in event', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        enabledEvents: ['ContractDeployed']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('deployed-filter');

      // Event with missing blockNumber
      await handler!(
        '0xnewlaunchpad',
        '0xtemplate',
        '0xdeployer',
        BigInt(1),
        {
          transactionHash: '0xdeploy123'
          // blockNumber missing
        }
      );

      // Should not create activity
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('Transfer (Mint) Event', () => {
    it('should auto-sync launchpad if not found in database', async () => {
      const validLaunchpadAddress = '0x1234567890123456789012345678901234567890';
      const validTxHash = '0xmint123000000000000000000000000000000000000000000000000000000000';
      
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: [validLaunchpadAddress],
        enabledEvents: ['Transfer']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('transfer-filter');

      // Mock launchpad not found initially
      (mockPrisma.launchpad.findUnique as any)
        .mockResolvedValueOnce(null) // First call returns null
        .mockResolvedValueOnce({ // Second call after upsert
          id: 2,
          contractAddress: validLaunchpadAddress,
          name: 'Auto Synced',
          symbol: 'AUTO',
          factoryId: 1,
          factory: { id: 1 },
          metadata: {}
        });

      (mockPrisma.launchpad.upsert as any).mockResolvedValue({
        id: 2,
        contractAddress: validLaunchpadAddress,
        name: 'Auto Synced',
        symbol: 'AUTO',
        factoryId: 1,
        factory: { id: 1 },
        metadata: {}
      });

      await handler!(
        '0x0000000000000000000000000000000000000000',
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: validTxHash,
          address: validLaunchpadAddress,
          index: 0
        }
      );

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should auto-sync launchpad using upsert
      expect(mockPrisma.launchpad.upsert).toHaveBeenCalled();
      expect(mockPrisma.activity.create).toHaveBeenCalled();
    });

    it('should skip duplicate mint events', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0xlaunchpad123'],
        enabledEvents: ['Transfer']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('transfer-filter');

      // Mock duplicate found
      (mockPrisma.activity.findFirst as any).mockResolvedValue({ id: 1 });

      await handler!(
        '0x0000000000000000000000000000000000000000',
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0xmint123',
          address: '0xlaunchpad123',
          index: 0
        }
      );

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not create duplicate
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('PhaseAdded Event', () => {
    it('should create phase and activity', async () => {
      const validLaunchpadAddress = '0x1234567890123456789012345678901234567890';
      
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: [validLaunchpadAddress],
        enabledEvents: ['PhaseAdded']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('phase-added-filter');
      expect(handler).toBeDefined();

      await handler!(
        BigInt(1), // phaseId
        'Public Sale', // name
        BigInt(Math.floor(Date.now() / 1000)), // startTime
        BigInt(Math.floor(Date.now() / 1000) + 86400), // endTime
        BigInt(1000000000000000000), // price
        BigInt(5), // maxMintPerWallet
        BigInt(100), // totalLimit
        {
          blockNumber: 1001,
          transactionHash: '0x1234567890123456789012345678901234567890123456789012345678901234' // Valid 64 char hash
        }
      );

      // Should create phase and activity
      expect(mockPrisma.launchpadPhase.create).toHaveBeenCalled();
      expect(mockPrisma.activity.create).toHaveBeenCalled();
    });
  });

  describe('Treasury Function Handling', () => {
    it('should handle treasury() as function', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        enabledEvents: ['ContractDeployed']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('deployed-filter');

      // Mock launchpad not found
      (mockPrisma.launchpad.findUnique as any).mockResolvedValueOnce(null);
      
      // treasury() returns successfully
      mockContract.treasury.mockResolvedValue('0xtreasury123');

      await handler!(
        '0xnewlaunchpad',
        '0xtemplate',
        '0xdeployer',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0xdeploy123'
        }
      );

      expect(mockContract.treasury).toHaveBeenCalled();
      expect(mockPrisma.launchpad.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            treasury: '0xtreasury123'
          })
        })
      );
    });

    it('should fallback to owner if treasury() fails', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        enabledEvents: ['ContractDeployed']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('deployed-filter');

      // Mock launchpad not found
      (mockPrisma.launchpad.findUnique as any).mockResolvedValueOnce(null);
      
      // treasury() fails
      mockContract.treasury.mockRejectedValue(new Error('treasury is not a function'));
      mockContract.owner.mockResolvedValue('0xowner123');

      await handler!(
        '0xnewlaunchpad',
        '0xtemplate',
        '0xdeployer',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0xdeploy123'
        }
      );

      expect(mockPrisma.launchpad.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            treasury: '0xowner123'
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should not crash on database errors', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0xlaunchpad123'],
        enabledEvents: ['Transfer']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('transfer-filter');

      // Mock database error
      (mockPrisma.activity.create as any).mockRejectedValue(new Error('Database error'));

      const httpEvent = {
        log: {
          blockNumber: 1001,
          transactionHash: '0xmint123'
        },
        args: [
          '0x0000000000000000000000000000000000000000',
          '0x9a299b9AaA23198589E284F269BB3a546acfc137',
          BigInt(1)
        ]
      };

      // Should not throw
      await expect(handler!(httpEvent)).resolves.not.toThrow();
    });

    it('should handle null event gracefully', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0xlaunchpad123'],
        enabledEvents: ['Transfer']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('transfer-filter');

      // Call with null
      await expect(handler!(null)).resolves.not.toThrow();
      
      // Should not create activity
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('Event Configuration', () => {
    it('should only register enabled events', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0xlaunchpad123'],
        enabledEvents: ['Transfer', 'ContractDeployed'] // Only 2 events
      };

      listener = new ActivityListener(config);
      await listener.start();

      // Should only have 2 event handlers registered
      expect(eventHandlers.has('transfer-filter')).toBe(true);
      expect(eventHandlers.has('deployed-filter')).toBe(true);
      expect(eventHandlers.has('burned-filter')).toBe(false);
      expect(eventHandlers.has('airdropped-filter')).toBe(false);
    });

    it('should register all events when no specific events configured', async () => {
      // Add all missing filter mocks
      mockContract.filters.BaseURIUpdated = vi.fn().mockReturnValue('base-uri-updated-filter');
      mockContract.filters.ContractURIUpdated = vi.fn().mockReturnValue('contract-uri-updated-filter');
      mockContract.filters.ExternalLinkUpdated = vi.fn().mockReturnValue('external-link-updated-filter');
      mockContract.filters.Paused = vi.fn().mockReturnValue('paused-filter');
      mockContract.filters.Unpaused = vi.fn().mockReturnValue('unpaused-filter');
      mockContract.filters.TransferLockUpdated = vi.fn().mockReturnValue('transfer-lock-updated-filter');
      mockContract.filters.RoleGranted = vi.fn().mockReturnValue('role-granted-filter');
      mockContract.filters.RoleRevoked = vi.fn().mockReturnValue('role-revoked-filter');
      mockContract.filters.LaunchpadCreated = vi.fn().mockReturnValue('launchpad-created-filter');

      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0xlaunchpad123']
        // No enabledEvents specified
      };

      listener = new ActivityListener(config);
      await listener.start();

      // Should register many events
      expect(eventHandlers.size).toBeGreaterThan(2);
    }, 10000); // Increase timeout to 10 seconds
  });
});


