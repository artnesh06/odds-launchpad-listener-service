/**
 * Room Strategy Unit Tests
 * 
 * Tests for room naming convention utilities
 */

import { describe, it, expect } from 'vitest';
import { RoomStrategy } from '../room-strategy';

describe('RoomStrategy', () => {
  const strategy = new RoomStrategy();

  describe('getHomepageRoom', () => {
    it('should return "homepage:all" when no chainId is provided', () => {
      expect(strategy.getHomepageRoom()).toBe('homepage:all');
      expect(strategy.getHomepageRoom(undefined)).toBe('homepage:all');
    });

    it('should return chain-specific room when chainId is provided', () => {
      expect(strategy.getHomepageRoom(1)).toBe('homepage:chain:1');
      expect(strategy.getHomepageRoom(137)).toBe('homepage:chain:137');
      expect(strategy.getHomepageRoom(42161)).toBe('homepage:chain:42161');
    });

    it('should handle chainId 0', () => {
      expect(strategy.getHomepageRoom(0)).toBe('homepage:chain:0');
    });
  });

  describe('getLaunchpadRoom', () => {
    it('should return launchpad room with normalized address', () => {
      const address = '0x1234567890123456789012345678901234567890';
      expect(strategy.getLaunchpadRoom(address)).toBe(`launchpad:${address.toLowerCase()}`);
    });

    it('should normalize uppercase addresses to lowercase', () => {
      const address = '0xABCDEF1234567890123456789012345678901234';
      expect(strategy.getLaunchpadRoom(address)).toBe(`launchpad:${address.toLowerCase()}`);
    });

    it('should throw error for invalid address format', () => {
      expect(() => strategy.getLaunchpadRoom('invalid')).toThrow('Invalid contract address format');
      expect(() => strategy.getLaunchpadRoom('0x123')).toThrow('Invalid contract address format');
      expect(() => strategy.getLaunchpadRoom('1234567890123456789012345678901234567890')).toThrow('Invalid contract address format');
    });

    it('should throw error for empty or null address', () => {
      expect(() => strategy.getLaunchpadRoom('')).toThrow('Contract address is required');
      expect(() => strategy.getLaunchpadRoom(null as any)).toThrow('Contract address is required');
      expect(() => strategy.getLaunchpadRoom(undefined as any)).toThrow('Contract address is required');
    });
  });

  describe('getWalletRoom', () => {
    it('should return wallet room with normalized address', () => {
      const address = '0x1234567890123456789012345678901234567890';
      expect(strategy.getWalletRoom(address)).toBe(`wallet:${address.toLowerCase()}`);
    });

    it('should normalize uppercase addresses to lowercase', () => {
      const address = '0xABCDEF1234567890123456789012345678901234';
      expect(strategy.getWalletRoom(address)).toBe(`wallet:${address.toLowerCase()}`);
    });

    it('should throw error for invalid address format', () => {
      expect(() => strategy.getWalletRoom('invalid')).toThrow('Invalid wallet address format');
      expect(() => strategy.getWalletRoom('0x123')).toThrow('Invalid wallet address format');
    });

    it('should throw error for empty or null address', () => {
      expect(() => strategy.getWalletRoom('')).toThrow('Wallet address is required');
      expect(() => strategy.getWalletRoom(null as any)).toThrow('Wallet address is required');
    });
  });

  describe('isValidRoom', () => {
    it('should validate homepage rooms', () => {
      expect(strategy.isValidRoom('homepage:all')).toBe(true);
      expect(strategy.isValidRoom('homepage:chain:1')).toBe(true);
      expect(strategy.isValidRoom('homepage:chain:137')).toBe(true);
    });

    it('should validate launchpad rooms', () => {
      expect(strategy.isValidRoom('launchpad:0x1234567890123456789012345678901234567890')).toBe(true);
    });

    it('should validate wallet rooms', () => {
      expect(strategy.isValidRoom('wallet:0x1234567890123456789012345678901234567890')).toBe(true);
    });

    it('should reject invalid room formats', () => {
      expect(strategy.isValidRoom('invalid')).toBe(false);
      expect(strategy.isValidRoom('homepage')).toBe(false);
      expect(strategy.isValidRoom('homepage:invalid')).toBe(false);
      expect(strategy.isValidRoom('launchpad:invalid')).toBe(false);
      expect(strategy.isValidRoom('wallet:invalid')).toBe(false);
      expect(strategy.isValidRoom('')).toBe(false);
      expect(strategy.isValidRoom(null as any)).toBe(false);
    });
  });

  describe('parseRoomInfo', () => {
    it('should parse homepage:all room', () => {
      const info = strategy.parseRoomInfo('homepage:all');
      expect(info.type).toBe('homepage');
      expect(info.chainId).toBeUndefined();
    });

    it('should parse chain-specific homepage room', () => {
      const info = strategy.parseRoomInfo('homepage:chain:137');
      expect(info.type).toBe('homepage');
      expect(info.chainId).toBe(137);
    });

    it('should parse launchpad room', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const info = strategy.parseRoomInfo(`launchpad:${address}`);
      expect(info.type).toBe('launchpad');
      expect(info.contractAddress).toBe(address);
    });

    it('should parse wallet room', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const info = strategy.parseRoomInfo(`wallet:${address}`);
      expect(info.type).toBe('wallet');
      expect(info.walletAddress).toBe(address);
    });

    it('should throw error for invalid room formats', () => {
      expect(() => strategy.parseRoomInfo('invalid')).toThrow('Unknown room type');
      expect(() => strategy.parseRoomInfo('homepage:invalid')).toThrow('Invalid homepage room format');
      expect(() => strategy.parseRoomInfo('homepage:chain:invalid')).toThrow('Invalid chain ID');
      expect(() => strategy.parseRoomInfo('homepage:chain:-1')).toThrow('Invalid chain ID');
      expect(() => strategy.parseRoomInfo('launchpad:')).toThrow('Contract address missing');
      expect(() => strategy.parseRoomInfo('launchpad:invalid')).toThrow('Invalid contract address format');
      expect(() => strategy.parseRoomInfo('wallet:')).toThrow('Wallet address missing');
      expect(() => strategy.parseRoomInfo('wallet:invalid')).toThrow('Invalid wallet address format');
    });

    it('should throw error for empty or null room name', () => {
      expect(() => strategy.parseRoomInfo('')).toThrow('Room name is required');
      expect(() => strategy.parseRoomInfo(null as any)).toThrow('Room name is required');
    });
  });
});
