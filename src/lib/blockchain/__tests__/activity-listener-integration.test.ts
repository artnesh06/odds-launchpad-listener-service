/**
 * Integration test for activity listener backward compatibility
 * Verifies that key event types are processed correctly after refactoring
 * Requirements: 8.1
 */

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
      update: vi.fn()
    },
    launchpadFactory: {
      findUnique: vi.fn()
    },
    launchpadPhase: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn()
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
    withRetry: vi.fn(async (fn) => await fn()),
    withDbLimit: vi.fn(async (fn) => await fn())
  };
});

// Mock error logger
vi.mock('../../../utils/error-logger', () => ({
  logError: vi.fn()
}));

describe('Activity Listener Integration - Event Processing', () => {
  let listener: ActivityListener;
  let mockProvider: any;
  let mockContract: any;
  let mockFactoryContract: any;
  let eventHandlers: Map<string, Function>;
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = new Map();
    
    // Get the mocked prisma
    mockPrisma = prisma;

    // Mock provider
    mockProvider = {
      getBlockNumber: vi.fn().mockResolvedValue(1000),
      getTransaction: vi.fn().mockResolvedValue({ value: BigInt(1000000000000000000) }),
      pollingInterval: 8000,
      destroy: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn(),
      on: vi.fn()
    };

    // Mock launchpad contract
    mockContract = {
      filters: {
        Transfer: vi.fn().mockReturnValue('transfer-filter'),
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
        RoyaltyUpdated: vi.fn().mockReturnValue('royalty-updated-filter'),
        BaseURIUpdated: vi.fn().mockReturnValue('base-uri-updated-filter'),
        ContractURIUpdated: vi.fn().mockReturnValue('contract-uri-updated-filter'),
        ExternalLinkUpdated: vi.fn().mockReturnValue('external-link-updated-filter'),
        Paused: vi.fn().mockReturnValue('paused-filter'),
        Unpaused: vi.fn().mockReturnValue('unpaused-filter'),
        TransferLockUpdated: vi.fn().mockReturnValue('transfer-lock-updated-filter'),
        RoleGranted: vi.fn().mockReturnValue('role-granted-filter'),
        RoleRevoked: vi.fn().mockReturnValue('role-revoked-filter')
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

    // Mock factory contract
    mockFactoryContract = {
      filters: {
        LaunchpadCreated: vi.fn().mockReturnValue('launchpad-created-filter')
      },
      on: vi.fn((filter, handler) => {
        eventHandlers.set(filter, handler);
      }),
      removeAllListeners: vi.fn(),
      queryFilter: vi.fn().mockResolvedValue([])
    };

    // Mock ethers constructors
    (ethers.JsonRpcProvider as any).mockReturnValue(mockProvider);
    (ethers.WebSocketProvider as any).mockReturnValue(mockProvider);
    (ethers.Contract as any).mockImplementation((address: string) => {
      if (address.toLowerCase().includes('factory')) {
        return mockFactoryContract;
      }
      return mockContract;
    });

    // Mock database responses
    (mockPrisma.launchpadFactory.findUnique as any).mockResolvedValue({
      id: 1,
      contractAddress: '0xfactory123',
      chainId: 6343
    });

    (mockPrisma.launchpad.findUnique as any).mockResolvedValue({
      id: 1,
      contractAddress: '0x1234567890123456789012345678901234567890',
      name: 'Test Collection',
      symbol: 'TEST',
      totalMaxSupply: 1000,
      factoryId: 1,
      creator: '0x1234567890123456789012345678901234567890',
      treasury: '0x1234567890123456789012345678901234567890',
      metadata: {},
      factory: { id: 1 }
    });

    (mockPrisma.activity.findFirst as any).mockResolvedValue(null);
    (mockPrisma.activity.create as any).mockResolvedValue({ id: 1 });
    (mockPrisma.launchpadPhase.findFirst as any).mockResolvedValue(null);
    (mockPrisma.launchpadPhase.create as any).mockResolvedValue({ id: 1 });
    
    // Mock $transaction to execute the callback immediately with mockPrisma
    (mockPrisma.$transaction as any).mockImplementation(async (callback: any) => {
      return await callback(mockPrisma);
    });
  });

  afterEach(async () => {
    if (listener) {
      try {
        await listener.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    vi.restoreAllMocks();
  });

  describe('Transfer (Mint) Event Processing', () => {
    it('should process mint event correctly', async () => {
      const validLaunchpadAddress = '0x1234567890123456789012345678901234567890';
      const validTxHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
      
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
      expect(handler).toBeDefined();

      // Simulate mint event (from zero address)
      await handler!(
        ethers.ZeroAddress,
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

      // Verify activity was created with correct type
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'MINT_OCCURRED',
            launchpadId: 1
          })
        })
      );
    });

    it('should process burn event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('burned-filter');
      expect(handler).toBeDefined();

      await handler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0x' + '2'.repeat(64)
        }
      );

      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'BURN_OCCURRED'
          })
        })
      );
    });
  });

  describe('Phase Event Processing', () => {
    it('should process PhaseAdded event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['PhaseAdded']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('phase-added-filter');
      expect(handler).toBeDefined();

      const now = Math.floor(Date.now() / 1000);
      await handler!(
        BigInt(1),
        'Public Sale',
        BigInt(now),
        BigInt(now + 86400),
        BigInt(1000000000000000000),
        BigInt(5),
        BigInt(100),
        {
          blockNumber: 1001,
          transactionHash: '0x' + '3'.repeat(64)
        }
      );

      // Verify phase was created
      expect(mockPrisma.launchpadPhase.create).toHaveBeenCalled();
      
      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PHASE_CREATED'
          })
        })
      );
    });

    it('should process PhaseUpdated event correctly', async () => {
      const validLaunchpadAddress = '0x1234567890123456789012345678901234567890';
      const validTxHash = '0x4444444444444444444444444444444444444444444444444444444444444444';
      
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: [validLaunchpadAddress],
        enabledEvents: ['PhaseUpdated']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('phase-updated-filter');
      expect(handler).toBeDefined();

      // Mock existing phase
      (mockPrisma.launchpadPhase.findFirst as any).mockResolvedValue({ id: 1 });

      const now = Math.floor(Date.now() / 1000);
      await handler!(
        BigInt(1),
        'Updated Sale',
        BigInt(now),
        BigInt(now + 86400),
        BigInt(2000000000000000000),
        BigInt(10),
        BigInt(200),
        {
          blockNumber: 1001,
          transactionHash: validTxHash,
          address: validLaunchpadAddress
        }
      );

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify phase was updated
      expect(mockPrisma.launchpadPhase.update).toHaveBeenCalled();
      
      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PHASE_UPDATED'
          })
        })
      );
    });
  });

  describe('Admin Event Processing', () => {
    it('should process TreasuryUpdated event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['TreasuryUpdated']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('treasury-updated-filter');
      expect(handler).toBeDefined();

      await handler!(
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        {
          blockNumber: 1001,
          transactionHash: '0x' + '5'.repeat(64)
        }
      );

      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TREASURY_UPDATED'
          })
        })
      );
    });

    it('should process OwnershipTransferred event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['OwnershipTransferred']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('ownership-transferred-filter');
      expect(handler).toBeDefined();

      await handler!(
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        {
          blockNumber: 1001,
          transactionHash: '0x' + '6'.repeat(64)
        }
      );

      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'OWNERSHIP_TRANSFERRED'
          })
        })
      );
    });
  });

  describe('Metadata Event Processing', () => {
    it('should process BaseURIUpdated event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['BaseURIUpdated']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('base-uri-updated-filter');
      expect(handler).toBeDefined();

      await handler!(
        'https://example.com/metadata/',
        {
          blockNumber: 1001,
          transactionHash: '0x' + '7'.repeat(64)
        }
      );

      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'METADATA_UPDATED'
          })
        })
      );
    });

    it('should process Revealed event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Revealed']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('revealed-filter');
      expect(handler).toBeDefined();

      await handler!(
        'https://example.com/revealed/',
        {
          blockNumber: 1001,
          transactionHash: '0x' + '8'.repeat(64)
        }
      );

      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'COLLECTION_REVEALED'
          })
        })
      );
    });
  });

  describe('Security Event Processing', () => {
    it('should process Paused event correctly', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Paused']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('paused-filter');
      expect(handler).toBeDefined();

      await handler!({
        blockNumber: 1001,
        transactionHash: '0x' + '9'.repeat(64)
      });

      // Verify activity was created
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CONTRACT_PAUSED'
          })
        })
      );
    });
  });

  describe('Database Format Consistency', () => {
    it('should maintain consistent activity record structure', async () => {
      const validLaunchpadAddress = '0x1234567890123456789012345678901234567890';
      const validTxHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      
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
      
      await handler!(
        ethers.ZeroAddress,
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

      // Verify all required fields are present
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: expect.any(String),
            launchpadId: expect.any(Number),
            txHash: expect.any(String),
            blockNumber: expect.any(Number),
            metadata: expect.any(Object)
          })
        })
      );
    });
  });
});


