/**
 * Unit tests for Phase Index Repair Service
 * 
 * Tests repair service functionality including:
 * - Repair with various mismatch scenarios
 * - Rollback on failure
 * - Idempotency (running repair multiple times)
 * - Validation before and after repair
 * 
 * Requirements: 8.4
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PhaseIndexVerificationService } from '../phase-index-verification-service';
import type { RepairResult } from '../phase-index-verification-service';

// Mock the database module
vi.mock('../../../../config/database', () => ({
  prisma: {
    launchpad: {
      findUnique: vi.fn(),
    },
    launchpadPhase: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock the provider service
vi.mock('../provider-service', () => {
  class MockProviderService {
    getProvider() {
      return {
        // Mock provider methods
      };
    }
    async destroy() {
      return undefined;
    }
  }
  
  return {
    ProviderService: MockProviderService,
  };
});

// Mock ethers
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      getAddress: vi.fn((addr: string) => addr.toLowerCase()),
      Contract: vi.fn(),
    },
  };
});

describe('Phase Index Repair Service', () => {
  let service: PhaseIndexVerificationService;
  let mockPrisma: any;
  let mockContract: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new PhaseIndexVerificationService();
    
    // Get mocked prisma
    const { prisma } = await import('../../../../config/database');
    mockPrisma = prisma;

    // Setup default mock contract
    mockContract = {
      allPhasesCount: vi.fn().mockResolvedValue(BigInt(3)),
      getMintPhase: vi.fn(),
    };

    // Mock ethers.Contract to return our mock contract
    const { ethers } = await import('ethers');
    (ethers.Contract as any).mockImplementation(() => mockContract);

    // Mock environment variable for RPC URL
    process.env.ETHEREUM_RPC_URL = 'https://eth.llamarpc.com';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Repair with Various Mismatch Scenarios', () => {
    it('should repair collection with wrong phase indices', async () => {
      // Setup: Database has phases with wrong indices
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [
          {
            id: 'phase-1',
            launchpadId: 'launchpad-1',
            phaseIndex: 1, // Wrong! Should be 0
            name: 'Phase 0',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 0,
            isActive: true,
            merkleRoot: null,
          },
          {
            id: 'phase-2',
            launchpadId: 'launchpad-1',
            phaseIndex: 2, // Wrong! Should be 1
            name: 'Phase 1',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 0,
            isActive: true,
            merkleRoot: null,
          },
        ],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      // Setup contract to return correct phases
      mockContract.allPhasesCount.mockResolvedValue(BigInt(2));
      mockContract.getMintPhase.mockImplementation((index: number) => ({
        name: `Phase ${index}`,
        startTime: BigInt(Math.floor(Date.now() / 1000)),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        price: BigInt(0),
        maxMintPerWallet: BigInt(10),
        maxSupply: BigInt(1000),
        isActive: true,
      }));

      // Setup transaction mock
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          launchpadPhase: {
            deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
            create: vi.fn().mockResolvedValue({}),
            findMany: vi.fn().mockResolvedValue([
              { phaseIndex: 0, name: 'Phase 0' },
              { phaseIndex: 1, name: 'Phase 1' },
            ]),
          },
        };
        return await callback(tx);
      });

      // Execute repair
      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      // Verify
      expect(result.success).toBe(true);
      expect(result.phasesRepaired).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should repair collection with missing phases in database', async () => {
      // Setup: Database has only 1 phase, contract has 3
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [
          {
            id: 'phase-1',
            launchpadId: 'launchpad-1',
            phaseIndex: 0,
            name: 'Phase 0',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 0,
            isActive: true,
            merkleRoot: null,
          },
        ],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      // Setup contract to return 3 phases
      mockContract.allPhasesCount.mockResolvedValue(BigInt(3));
      mockContract.getMintPhase.mockImplementation((index: number) => ({
        name: `Phase ${index}`,
        startTime: BigInt(Math.floor(Date.now() / 1000)),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        price: BigInt(0),
        maxMintPerWallet: BigInt(10),
        maxSupply: BigInt(1000),
        isActive: true,
      }));

      // Setup transaction mock
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          launchpadPhase: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue({}),
            findMany: vi.fn().mockResolvedValue([
              { phaseIndex: 0, name: 'Phase 0' },
              { phaseIndex: 1, name: 'Phase 1' },
              { phaseIndex: 2, name: 'Phase 2' },
            ]),
          },
        };
        return await callback(tx);
      });

      // Execute repair
      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      // Verify
      expect(result.success).toBe(true);
      expect(result.phasesRepaired).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should repair collection with extra phases in database', async () => {
      // Setup: Database has 5 phases, contract has 3
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: Array.from({ length: 5 }, (_, i) => ({
          id: `phase-${i}`,
          launchpadId: 'launchpad-1',
          phaseIndex: i,
          name: `Phase ${i}`,
          phaseType: 'PUBLIC',
          startTime: new Date(),
          endTime: new Date(Date.now() + 86400000),
          price: '0',
          maxMintPerWallet: 10,
          totalLimit: 1000,
          mintedCount: 0,
          isActive: true,
          merkleRoot: null,
        })),
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      // Setup contract to return 3 phases
      mockContract.allPhasesCount.mockResolvedValue(BigInt(3));
      mockContract.getMintPhase.mockImplementation((index: number) => ({
        name: `Phase ${index}`,
        startTime: BigInt(Math.floor(Date.now() / 1000)),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        price: BigInt(0),
        maxMintPerWallet: BigInt(10),
        maxSupply: BigInt(1000),
        isActive: true,
      }));

      // Setup transaction mock
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          launchpadPhase: {
            deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
            create: vi.fn().mockResolvedValue({}),
            findMany: vi.fn().mockResolvedValue([
              { phaseIndex: 0, name: 'Phase 0' },
              { phaseIndex: 1, name: 'Phase 1' },
              { phaseIndex: 2, name: 'Phase 2' },
            ]),
          },
        };
        return await callback(tx);
      });

      // Execute repair
      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      // Verify
      expect(result.success).toBe(true);
      expect(result.phasesRepaired).toBe(3);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Rollback on Failure', () => {
    it('should rollback when post-repair validation fails', async () => {
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [
          {
            id: 'phase-1',
            launchpadId: 'launchpad-1',
            phaseIndex: 0,
            name: 'Original Phase',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 5,
            isActive: true,
            merkleRoot: null,
          },
        ],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      mockContract.allPhasesCount.mockResolvedValue(BigInt(2));
      mockContract.getMintPhase.mockImplementation((index: number) => ({
        name: `Phase ${index}`,
        startTime: BigInt(Math.floor(Date.now() / 1000)),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        price: BigInt(0),
        maxMintPerWallet: BigInt(10),
        maxSupply: BigInt(1000),
        isActive: true,
      }));

      // Setup transaction to fail on validation
      let transactionCallCount = 0;
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        transactionCallCount++;
        
        if (transactionCallCount === 1) {
          // First transaction (repair attempt) - return wrong phase count to trigger validation failure
          const tx = {
            launchpadPhase: {
              deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
              create: vi.fn().mockResolvedValue({}),
              findMany: vi.fn().mockResolvedValue([
                { phaseIndex: 0, name: 'Phase 0' },
                // Missing phase 1 - validation should fail
              ]),
            },
          };
          return await callback(tx);
        } else {
          // Second transaction (rollback) - restore original phase
          const tx = {
            launchpadPhase: {
              deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
              create: vi.fn().mockResolvedValue({}),
            },
          };
          return await callback(tx);
        }
      });

      // Execute repair
      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      // Verify rollback occurred
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Phase count mismatch'))).toBe(true);
      expect(result.errors.some(e => e.includes('Rollback successful'))).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2); // Once for repair, once for rollback
    });

    it('should rollback when contract fetch fails mid-repair', async () => {
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [
          {
            id: 'phase-1',
            launchpadId: 'launchpad-1',
            phaseIndex: 0,
            name: 'Original Phase',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 0,
            isActive: true,
            merkleRoot: null,
          },
        ],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      mockContract.allPhasesCount.mockResolvedValue(BigInt(3));
      mockContract.getMintPhase.mockImplementation((index: number) => {
        if (index === 1) {
          throw new Error('Contract error fetching phase 1');
        }
        return {
          name: `Phase ${index}`,
          startTime: BigInt(Math.floor(Date.now() / 1000)),
          endTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
          price: BigInt(0),
          maxMintPerWallet: BigInt(10),
          maxSupply: BigInt(1000),
          isActive: true,
        };
      });

      // Execute repair
      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      // Verify error was caught and repair failed
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Error fetching phase 1'))).toBe(true);
    });

    it('should handle rollback failure gracefully', async () => {
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [
          {
            id: 'phase-1',
            launchpadId: 'launchpad-1',
            phaseIndex: 0,
            name: 'Original Phase',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 0,
            isActive: true,
            merkleRoot: null,
          },
        ],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      mockContract.allPhasesCount.mockResolvedValue(BigInt(2));
      mockContract.getMintPhase.mockImplementation((index: number) => ({
        name: `Phase ${index}`,
        startTime: BigInt(Math.floor(Date.now() / 1000)),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        price: BigInt(0),
        maxMintPerWallet: BigInt(10),
        maxSupply: BigInt(1000),
        isActive: true,
      }));

      // Setup transaction to fail on both repair and rollback
      let transactionCallCount = 0;
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        transactionCallCount++;
        
        if (transactionCallCount === 1) {
          // First transaction (repair attempt) - fail validation
          const tx = {
            launchpadPhase: {
              deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
              create: vi.fn().mockResolvedValue({}),
              findMany: vi.fn().mockResolvedValue([
                { phaseIndex: 0, name: 'Phase 0' },
              ]),
            },
          };
          return await callback(tx);
        } else {
          // Second transaction (rollback) - fail
          throw new Error('Database error during rollback');
        }
      });

      // Execute repair
      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      // Verify both failures are reported
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Rollback failed'))).toBe(true);
      expect(result.errors.some(e => e.includes('CRITICAL'))).toBe(true);
    });
  });

  describe('Idempotency', () => {
    it('should produce same result when run multiple times on consistent data', async () => {
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [
          {
            id: 'phase-1',
            launchpadId: 'launchpad-1',
            phaseIndex: 0,
            name: 'Phase 0',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 0,
            isActive: true,
            merkleRoot: null,
          },
          {
            id: 'phase-2',
            launchpadId: 'launchpad-1',
            phaseIndex: 1,
            name: 'Phase 1',
            phaseType: 'PUBLIC',
            startTime: new Date(),
            endTime: new Date(Date.now() + 86400000),
            price: '0',
            maxMintPerWallet: 10,
            totalLimit: 1000,
            mintedCount: 0,
            isActive: true,
            merkleRoot: null,
          },
        ],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      mockContract.allPhasesCount.mockResolvedValue(BigInt(2));
      mockContract.getMintPhase.mockImplementation((index: number) => ({
        name: `Phase ${index}`,
        startTime: BigInt(Math.floor(Date.now() / 1000)),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400),
        price: BigInt(0),
        maxMintPerWallet: BigInt(10),
        maxSupply: BigInt(1000),
        isActive: true,
      }));

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          launchpadPhase: {
            deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
            create: vi.fn().mockResolvedValue({}),
            findMany: vi.fn().mockResolvedValue([
              { phaseIndex: 0, name: 'Phase 0' },
              { phaseIndex: 1, name: 'Phase 1' },
            ]),
          },
        };
        return await callback(tx);
      });

      // Run repair multiple times
      const result1 = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');
      const result2 = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');
      const result3 = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      // All results should be successful and identical
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);
      expect(result1.phasesRepaired).toBe(2);
      expect(result2.phasesRepaired).toBe(2);
      expect(result3.phasesRepaired).toBe(2);
    });
  });

  describe('Validation', () => {
    it('should reject repair when contract has no phases', async () => {
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);
      mockContract.allPhasesCount.mockResolvedValue(BigInt(0));

      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Contract has no phases to sync');
    });

    it('should reject repair when contract phases have invalid data', async () => {
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Test Collection',
        phases: [],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);
      mockContract.allPhasesCount.mockResolvedValue(BigInt(2));
      mockContract.getMintPhase.mockImplementation((index: number) => ({
        name: '', // Invalid: empty name
        startTime: BigInt(Math.floor(Date.now() / 1000)),
        endTime: BigInt(Math.floor(Date.now() / 1000) - 86400), // Invalid: end before start
        price: BigInt(0),
        maxMintPerWallet: BigInt(0), // Invalid: zero
        maxSupply: BigInt(-1), // Invalid: negative
        isActive: true,
      }));

      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('empty name'))).toBe(true);
    });

    it('should reject repair when launchpad not found', async () => {
      mockPrisma.launchpad.findUnique.mockResolvedValue(null);

      const result = await service.repairCollection(1, '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Launchpad not found: 0x1234567890123456789012345678901234567890 on chain 1');
    });

    it('should reject repair when RPC URL not configured', async () => {
      const mockLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: 999,
        name: 'Test Collection',
        phases: [],
      };

      mockPrisma.launchpad.findUnique.mockResolvedValue(mockLaunchpad);

      const result = await service.repairCollection(999, '0x1234567890123456789012345678901234567890');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('No RPC URL configured for chain 999');
    });
  });
});
