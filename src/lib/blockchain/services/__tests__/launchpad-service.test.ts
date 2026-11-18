/**
 * Unit tests for LaunchpadService
 * 
 * Tests the LaunchpadService methods, particularly getFeaturedLaunchpads
 * which implements task 7.2.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LaunchpadService } from '../launchpad-service';
import { WebSocketManager } from '../../websocket-manager';
import { PrismaClient } from '@prisma/client';

// Create a mock Prisma client
const mockPrisma = {
  launchpad: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
} as unknown as PrismaClient;

// Create a mock WebSocketManager
const mockWebSocketManager = {
  addListener: vi.fn(),
  removeListener: vi.fn(),
  initialize: vi.fn(),
  shutdown: vi.fn(),
} as unknown as WebSocketManager;

describe('LaunchpadService', () => {
  let service: LaunchpadService;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Create service instance with mocks
    service = new LaunchpadService(mockWebSocketManager, mockPrisma);
  });

  describe('Task 7.1: updateFeaturedStatus', () => {
    it('should throw error when launchpad is not found', async () => {
      // Arrange
      const launchpadId = 'non-existent-id';
      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(service.updateFeaturedStatus(launchpadId, true))
        .rejects.toThrow(`Launchpad ${launchpadId} not found`);
      
      expect(mockPrisma.launchpad.findUnique).toHaveBeenCalledWith({
        where: { id: launchpadId },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          isFeatured: true
        }
      });
      expect(mockPrisma.launchpad.update).not.toHaveBeenCalled();
      expect(mockWebSocketManager.addListener).not.toHaveBeenCalled();
      expect(mockWebSocketManager.removeListener).not.toHaveBeenCalled();
    });

    it('should update database and add WebSocket listener when changing to featured=true', async () => {
      // Arrange
      const launchpadId = 'launchpad-1';
      const mockLaunchpad = {
        id: launchpadId,
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Test Launchpad',
        isFeatured: false
      };

      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);
      mockPrisma.launchpad.update = vi.fn().mockResolvedValue({ ...mockLaunchpad, isFeatured: true });
      mockWebSocketManager.addListener = vi.fn().mockResolvedValue(undefined);

      // Act
      await service.updateFeaturedStatus(launchpadId, true);

      // Assert
      expect(mockPrisma.launchpad.findUnique).toHaveBeenCalledWith({
        where: { id: launchpadId },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          isFeatured: true
        }
      });
      expect(mockPrisma.launchpad.update).toHaveBeenCalledWith({
        where: { id: launchpadId },
        data: { isFeatured: true }
      });
      expect(mockWebSocketManager.addListener).toHaveBeenCalledWith(mockLaunchpad.contractAddress);
      expect(mockWebSocketManager.removeListener).not.toHaveBeenCalled();
    });

    it('should update database and remove WebSocket listener when changing to featured=false', async () => {
      // Arrange
      const launchpadId = 'launchpad-1';
      const mockLaunchpad = {
        id: launchpadId,
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Test Launchpad',
        isFeatured: true
      };

      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);
      mockPrisma.launchpad.update = vi.fn().mockResolvedValue({ ...mockLaunchpad, isFeatured: false });
      mockWebSocketManager.removeListener = vi.fn().mockResolvedValue(undefined);

      // Act
      await service.updateFeaturedStatus(launchpadId, false);

      // Assert
      expect(mockPrisma.launchpad.findUnique).toHaveBeenCalledWith({
        where: { id: launchpadId },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          isFeatured: true
        }
      });
      expect(mockPrisma.launchpad.update).toHaveBeenCalledWith({
        where: { id: launchpadId },
        data: { isFeatured: false }
      });
      expect(mockWebSocketManager.removeListener).toHaveBeenCalledWith(mockLaunchpad.contractAddress);
      expect(mockWebSocketManager.addListener).not.toHaveBeenCalled();
    });

    it('should not change WebSocket listener when status is already the same', async () => {
      // Arrange
      const launchpadId = 'launchpad-1';
      const mockLaunchpad = {
        id: launchpadId,
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Test Launchpad',
        isFeatured: true
      };

      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);

      // Act
      await service.updateFeaturedStatus(launchpadId, true);

      // Assert
      expect(mockPrisma.launchpad.findUnique).toHaveBeenCalledWith({
        where: { id: launchpadId },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          isFeatured: true
        }
      });
      expect(mockPrisma.launchpad.update).not.toHaveBeenCalled();
      expect(mockWebSocketManager.addListener).not.toHaveBeenCalled();
      expect(mockWebSocketManager.removeListener).not.toHaveBeenCalled();
    });

    it('should throw error when WebSocket manager fails to add listener', async () => {
      // Arrange
      const launchpadId = 'launchpad-1';
      const mockLaunchpad = {
        id: launchpadId,
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Test Launchpad',
        isFeatured: false
      };
      const wsError = new Error('WebSocket connection failed');

      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);
      mockPrisma.launchpad.update = vi.fn().mockResolvedValue({ ...mockLaunchpad, isFeatured: true });
      mockWebSocketManager.addListener = vi.fn().mockRejectedValue(wsError);

      // Act & Assert
      await expect(service.updateFeaturedStatus(launchpadId, true))
        .rejects.toThrow(`Failed to manage WebSocket connection for launchpad ${launchpadId}: WebSocket connection failed`);
      
      expect(mockPrisma.launchpad.update).toHaveBeenCalled();
      expect(mockWebSocketManager.addListener).toHaveBeenCalledWith(mockLaunchpad.contractAddress);
    });

    it('should throw error when WebSocket manager fails to remove listener', async () => {
      // Arrange
      const launchpadId = 'launchpad-1';
      const mockLaunchpad = {
        id: launchpadId,
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Test Launchpad',
        isFeatured: true
      };
      const wsError = new Error('Failed to remove listener');

      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);
      mockPrisma.launchpad.update = vi.fn().mockResolvedValue({ ...mockLaunchpad, isFeatured: false });
      mockWebSocketManager.removeListener = vi.fn().mockRejectedValue(wsError);

      // Act & Assert
      await expect(service.updateFeaturedStatus(launchpadId, false))
        .rejects.toThrow(`Failed to manage WebSocket connection for launchpad ${launchpadId}: Failed to remove listener`);
      
      expect(mockPrisma.launchpad.update).toHaveBeenCalled();
      expect(mockWebSocketManager.removeListener).toHaveBeenCalledWith(mockLaunchpad.contractAddress);
    });

    it('should accept boolean parameters correctly', async () => {
      // Arrange
      const launchpadId = 'launchpad-1';
      const mockLaunchpad = {
        id: launchpadId,
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Test Launchpad',
        isFeatured: false
      };

      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);
      mockPrisma.launchpad.update = vi.fn().mockResolvedValue({ ...mockLaunchpad, isFeatured: true });
      mockWebSocketManager.addListener = vi.fn().mockResolvedValue(undefined);

      // Act - Test with explicit true
      await service.updateFeaturedStatus(launchpadId, true);

      // Assert
      expect(mockPrisma.launchpad.update).toHaveBeenCalledWith({
        where: { id: launchpadId },
        data: { isFeatured: true }
      });

      // Reset mocks
      vi.clearAllMocks();
      mockLaunchpad.isFeatured = true;
      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);
      mockPrisma.launchpad.update = vi.fn().mockResolvedValue({ ...mockLaunchpad, isFeatured: false });
      mockWebSocketManager.removeListener = vi.fn().mockResolvedValue(undefined);

      // Act - Test with explicit false
      await service.updateFeaturedStatus(launchpadId, false);

      // Assert
      expect(mockPrisma.launchpad.update).toHaveBeenCalledWith({
        where: { id: launchpadId },
        data: { isFeatured: false }
      });
    });

    it('should query current launchpad before updating', async () => {
      // Arrange
      const launchpadId = 'launchpad-1';
      const mockLaunchpad = {
        id: launchpadId,
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Test Launchpad',
        isFeatured: false
      };

      mockPrisma.launchpad.findUnique = vi.fn().mockResolvedValue(mockLaunchpad);
      mockPrisma.launchpad.update = vi.fn().mockResolvedValue({ ...mockLaunchpad, isFeatured: true });
      mockWebSocketManager.addListener = vi.fn().mockResolvedValue(undefined);

      // Act
      await service.updateFeaturedStatus(launchpadId, true);

      // Assert - Verify findUnique is called before update
      const findUniqueCall = mockPrisma.launchpad.findUnique.mock.invocationCallOrder[0];
      const updateCall = mockPrisma.launchpad.update.mock.invocationCallOrder[0];
      expect(findUniqueCall).toBeLessThan(updateCall);
    });
  });

  describe('Task 7.2: getFeaturedLaunchpads', () => {
    it('should query database for launchpads where isFeatured=true', async () => {
      // Arrange
      const mockFeaturedLaunchpads = [
        {
          id: 'launchpad-1',
          contractAddress: '0x1234567890123456789012345678901234567890',
          name: 'Featured Launchpad 1',
          symbol: 'FLP1',
          description: 'A featured launchpad',
          chainId: 1,
          creator: '0xCreator1',
          totalMaxSupply: 1000,
          mintedCount: 100,
          status: 'ACTIVE',
          isFeatured: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'launchpad-2',
          contractAddress: '0x2234567890123456789012345678901234567890',
          name: 'Featured Launchpad 2',
          symbol: 'FLP2',
          description: 'Another featured launchpad',
          chainId: 1,
          creator: '0xCreator2',
          totalMaxSupply: 2000,
          mintedCount: 200,
          status: 'ACTIVE',
          isFeatured: true,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
      ];

      mockPrisma.launchpad.findMany = vi.fn().mockResolvedValue(mockFeaturedLaunchpads);

      // Act
      const result = await service.getFeaturedLaunchpads();

      // Assert
      expect(mockPrisma.launchpad.findMany).toHaveBeenCalledWith({
        where: { isFeatured: true },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          symbol: true,
          description: true,
          chainId: true,
          creator: true,
          totalMaxSupply: true,
          mintedCount: true,
          status: true,
          isFeatured: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      expect(result).toEqual(mockFeaturedLaunchpads);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no featured launchpads exist', async () => {
      // Arrange
      mockPrisma.launchpad.findMany = vi.fn().mockResolvedValue([]);

      // Act
      const result = await service.getFeaturedLaunchpads();

      // Assert
      expect(mockPrisma.launchpad.findMany).toHaveBeenCalledWith({
        where: { isFeatured: true },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          symbol: true,
          description: true,
          chainId: true,
          creator: true,
          totalMaxSupply: true,
          mintedCount: true,
          status: true,
          isFeatured: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should return only launchpads with isFeatured=true', async () => {
      // Arrange
      const mockFeaturedLaunchpads = [
        {
          id: 'launchpad-featured',
          contractAddress: '0x1234567890123456789012345678901234567890',
          name: 'Featured Launchpad',
          symbol: 'FLP',
          description: 'A featured launchpad',
          chainId: 1,
          creator: '0xCreator',
          totalMaxSupply: 1000,
          mintedCount: 100,
          status: 'ACTIVE',
          isFeatured: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      mockPrisma.launchpad.findMany = vi.fn().mockResolvedValue(mockFeaturedLaunchpads);

      // Act
      const result = await service.getFeaturedLaunchpads();

      // Assert
      expect(result.every(lp => lp.isFeatured === true)).toBe(true);
    });

    it('should return launchpads ordered by createdAt desc', async () => {
      // Arrange
      const mockFeaturedLaunchpads = [
        {
          id: 'launchpad-2',
          contractAddress: '0x2234567890123456789012345678901234567890',
          name: 'Newer Launchpad',
          symbol: 'NLP',
          description: 'Newer launchpad',
          chainId: 1,
          creator: '0xCreator2',
          totalMaxSupply: 2000,
          mintedCount: 200,
          status: 'ACTIVE',
          isFeatured: true,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'launchpad-1',
          contractAddress: '0x1234567890123456789012345678901234567890',
          name: 'Older Launchpad',
          symbol: 'OLP',
          description: 'Older launchpad',
          chainId: 1,
          creator: '0xCreator1',
          totalMaxSupply: 1000,
          mintedCount: 100,
          status: 'ACTIVE',
          isFeatured: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      mockPrisma.launchpad.findMany = vi.fn().mockResolvedValue(mockFeaturedLaunchpads);

      // Act
      const result = await service.getFeaturedLaunchpads();

      // Assert
      expect(mockPrisma.launchpad.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            createdAt: 'desc',
          },
        })
      );
      expect(result[0].createdAt.getTime()).toBeGreaterThan(result[1].createdAt.getTime());
    });

    it('should include all required fields in the response', async () => {
      // Arrange
      const mockFeaturedLaunchpad = {
        id: 'launchpad-1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        name: 'Featured Launchpad',
        symbol: 'FLP',
        description: 'A featured launchpad',
        chainId: 1,
        creator: '0xCreator',
        totalMaxSupply: 1000,
        mintedCount: 100,
        status: 'ACTIVE',
        isFeatured: true,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockPrisma.launchpad.findMany = vi.fn().mockResolvedValue([mockFeaturedLaunchpad]);

      // Act
      const result = await service.getFeaturedLaunchpads();

      // Assert
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('contractAddress');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('symbol');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('chainId');
      expect(result[0]).toHaveProperty('creator');
      expect(result[0]).toHaveProperty('totalMaxSupply');
      expect(result[0]).toHaveProperty('mintedCount');
      expect(result[0]).toHaveProperty('status');
      expect(result[0]).toHaveProperty('isFeatured');
      expect(result[0]).toHaveProperty('createdAt');
      expect(result[0]).toHaveProperty('updatedAt');
    });
  });
});
