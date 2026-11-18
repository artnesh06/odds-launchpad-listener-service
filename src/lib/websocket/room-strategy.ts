/**
 * Room Strategy
 * 
 * Defines room naming conventions and validation logic for WebSocket rooms.
 * Rooms are used to group clients based on their context (homepage, launchpad, wallet).
 * 
 * Room naming convention:
 * - homepage:all - All chains homepage
 * - homepage:chain:{chainId} - Specific chain homepage
 * - launchpad:{contractAddress} - Specific launchpad/collection
 * - wallet:{address} - Specific wallet address
 */

/**
 * Room information parsed from room name
 */
export interface RoomInfo {
  type: 'homepage' | 'launchpad' | 'wallet';
  chainId?: number;
  contractAddress?: string;
  walletAddress?: string;
}

/**
 * Room Strategy class for managing room naming and validation
 */
export class RoomStrategy {
  /**
   * Get homepage room name with optional chain filter
   * 
   * @param chainId - Optional chain ID to filter by specific chain
   * @returns Room name for homepage (e.g., "homepage:all" or "homepage:chain:1")
   */
  getHomepageRoom(chainId?: number): string {
    if (chainId === undefined || chainId === null) {
      return 'homepage:all';
    }
    return `homepage:chain:${chainId}`;
  }

  /**
   * Get launchpad room name for a specific contract
   * 
   * @param contractAddress - Contract address (should be checksummed)
   * @returns Room name for launchpad (e.g., "launchpad:0x123...")
   */
  getLaunchpadRoom(contractAddress: string): string {
    if (!contractAddress || typeof contractAddress !== 'string') {
      throw new Error('Contract address is required and must be a string');
    }

    // Normalize address to lowercase for consistency
    const normalizedAddress = contractAddress.toLowerCase();

    // Basic validation: should start with 0x and be 42 characters
    if (!normalizedAddress.startsWith('0x') || normalizedAddress.length !== 42) {
      throw new Error('Invalid contract address format');
    }

    return `launchpad:${normalizedAddress}`;
  }

  /**
   * Get wallet room name for a specific wallet address
   * 
   * @param address - Wallet address (should be checksummed)
   * @returns Room name for wallet (e.g., "wallet:0x123...")
   */
  getWalletRoom(address: string): string {
    if (!address || typeof address !== 'string') {
      throw new Error('Wallet address is required and must be a string');
    }

    // Normalize address to lowercase for consistency
    const normalizedAddress = address.toLowerCase();

    // Basic validation: should start with 0x and be 42 characters
    if (!normalizedAddress.startsWith('0x') || normalizedAddress.length !== 42) {
      throw new Error('Invalid wallet address format');
    }

    return `wallet:${normalizedAddress}`;
  }

  /**
   * Validate if a room name follows the correct format
   * 
   * @param room - Room name to validate
   * @returns True if room name is valid, false otherwise
   */
  isValidRoom(room: string): boolean {
    if (!room || typeof room !== 'string') {
      return false;
    }

    try {
      // Try to parse the room info
      this.parseRoomInfo(room);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse room information from room name
   * 
   * @param room - Room name to parse
   * @returns Parsed room information
   * @throws Error if room name format is invalid
   */
  parseRoomInfo(room: string): RoomInfo {
    if (!room || typeof room !== 'string') {
      throw new Error('Room name is required and must be a string');
    }

    // Homepage rooms: homepage:all or homepage:chain:{chainId}
    if (room.startsWith('homepage:')) {
      const parts = room.split(':');
      
      if (parts.length === 2 && parts[1] === 'all') {
        return { type: 'homepage' };
      }
      
      if (parts.length === 3 && parts[1] === 'chain') {
        const chainId = parseInt(parts[2], 10);
        if (isNaN(chainId) || chainId < 0) {
          throw new Error('Invalid chain ID in room name');
        }
        return { type: 'homepage', chainId };
      }
      
      throw new Error('Invalid homepage room format');
    }

    // Launchpad rooms: launchpad:{contractAddress}
    if (room.startsWith('launchpad:')) {
      const contractAddress = room.substring('launchpad:'.length);
      
      if (!contractAddress) {
        throw new Error('Contract address missing in launchpad room');
      }
      
      // Validate address format
      if (!contractAddress.startsWith('0x') || contractAddress.length !== 42) {
        throw new Error('Invalid contract address format in room name');
      }
      
      return { type: 'launchpad', contractAddress };
    }

    // Wallet rooms: wallet:{address}
    if (room.startsWith('wallet:')) {
      const walletAddress = room.substring('wallet:'.length);
      
      if (!walletAddress) {
        throw new Error('Wallet address missing in wallet room');
      }
      
      // Validate address format
      if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
        throw new Error('Invalid wallet address format in room name');
      }
      
      return { type: 'wallet', walletAddress };
    }

    throw new Error(`Unknown room type: ${room}`);
  }
}

/**
 * Singleton instance of RoomStrategy
 */
export const roomStrategy = new RoomStrategy();
