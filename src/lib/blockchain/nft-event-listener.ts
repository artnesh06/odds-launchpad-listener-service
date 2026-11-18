import { ethers } from 'ethers';
import { prisma } from '../../config/database';
import { TransferType } from '@prisma/client';
import { logError } from '../../utils/error-logger';
import type { NFTEventHandler } from './event-handlers/nft-events';

// WebSocket polyfill for Node.js environment
if (typeof WebSocket === 'undefined') {
  try {
    const WS = require('ws');
    (global as any).WebSocket = WS;
  } catch (error) {
    // Silent fail - will use HTTP providers as fallback
  }
}

/**
 * NFT Event Listener
 * 
 * Listens to standard ERC721/ERC1155 events from NFT contracts:
 * - Transfer events (mints, transfers, burns)
 * - Approval events
 * - ApprovalForAll events
 * 
 * Requirements: 11.1, 11.2, 11.3, 8.1, 8.2
 */

// Standard ERC721/ERC1155 ABI fragments
const ERC721_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
];

const ERC1155_ABI = [
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
  'event ApprovalForAll(address indexed account, address indexed operator, bool approved)',
];

export interface NFTContractConfig {
  address: string;
  tokenType: 'ERC721' | 'ERC1155';
  chainId: number;
}

export interface NFTEventListenerConfig {
  chainId: number;
  rpcUrl: string;
  contracts: NFTContractConfig[];
  errorThreshold?: number;
  retryAttempts?: number;
  nftEventHandler?: NFTEventHandler; // Optional handler for processing events
}

interface TransferEventData {
  contractAddress: string;
  tokenId: string;
  from: string;
  to: string;
  quantity: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  logIndex: number;
  tokenType: 'ERC721' | 'ERC1155';
}

interface ApprovalEventData {
  contractAddress: string;
  owner: string;
  approved: string;
  tokenId?: string; // Only for ERC721 Approval
  txHash: string;
  blockNumber: number;
}

interface ApprovalForAllEventData {
  contractAddress: string;
  owner: string;
  operator: string;
  approved: boolean;
  txHash: string;
  blockNumber: number;
}

export class NFTEventListener {
  private provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
  private contracts: Map<string, { contract: ethers.Contract; config: NFTContractConfig }> = new Map();
  private config: NFTEventListenerConfig;
  private isRunning: boolean = false;
  private errorThreshold: number;
  private maxDatabaseRetries: number;
  private nftEventHandler?: NFTEventHandler;

  constructor(config: NFTEventListenerConfig) {
    this.config = config;
    this.errorThreshold = config.errorThreshold ?? 10;
    this.maxDatabaseRetries = config.retryAttempts ?? 3;
    this.nftEventHandler = config.nftEventHandler;

    // Initialize provider - always use HTTP to avoid eth_subscribe issues
    const rpcUrl = config.rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    const network = ethers.Network.from(config.chainId);
    this.provider = new ethers.JsonRpcProvider(rpcUrl, network, {
      staticNetwork: true // Skip network detection to avoid "failed to detect network" errors
    });
    this.provider.pollingInterval = 8000; // 8 seconds
    console.log(`📡 NFT Listener: Using HTTP provider for chain ${config.chainId} (polling: 8s)`);
    console.log(`   └─ Note: WebSocket subscriptions disabled to avoid eth_subscribe errors`);

    // Initialize contracts
    this.initializeContracts(config.contracts);
  }

  /**
   * Initialize NFT contracts with appropriate ABIs
   */
  private initializeContracts(contracts: NFTContractConfig[]): void {
    for (const contractConfig of contracts) {
      // Validate address before creating contract (prevents ENS resolution on non-ENS chains)
      if (!ethers.isAddress(contractConfig.address)) {
        console.warn(`⚠️ Skipping invalid NFT contract address: ${contractConfig.address}`);
        continue;
      }

      const abi = contractConfig.tokenType === 'ERC721' ? ERC721_ABI : ERC1155_ABI;
      const contract = new ethers.Contract(contractConfig.address, abi, this.provider);
      
      this.contracts.set(contractConfig.address.toLowerCase(), {
        contract,
        config: contractConfig
      });
    }
    
    console.log(`✅ Initialized ${this.contracts.size} NFT contracts for chain ${this.config.chainId}`);
  }

  /**
   * Add a new NFT contract to listen to
   * Requirements: 8.4
   */
  async addContract(contractConfig: NFTContractConfig): Promise<void> {
    // Validate address before processing (prevents ENS resolution on non-ENS chains)
    if (!ethers.isAddress(contractConfig.address)) {
      console.warn(`⚠️ Cannot add NFT contract: Invalid address ${contractConfig.address}`);
      return;
    }

    const normalizedAddress = contractConfig.address.toLowerCase();
    
    if (this.contracts.has(normalizedAddress)) {
      console.log(`⚠️ Contract ${contractConfig.address} already being monitored`);
      return;
    }

    const abi = contractConfig.tokenType === 'ERC721' ? ERC721_ABI : ERC1155_ABI;
    const contract = new ethers.Contract(contractConfig.address, abi, this.provider);
    
    this.contracts.set(normalizedAddress, {
      contract,
      config: contractConfig
    });

    // If listener is running, set up listeners for this new contract
    if (this.isRunning) {
      await this.setupContractListeners(normalizedAddress);
    }

    console.log(`✅ Added NFT contract ${contractConfig.address} (${contractConfig.tokenType})`);
  }

  /**
   * Remove an NFT contract from listening
   * Requirements: 8.4
   */
  async removeContract(contractAddress: string): Promise<void> {
    const normalizedAddress = contractAddress.toLowerCase();
    const contractData = this.contracts.get(normalizedAddress);

    if (!contractData) {
      console.log(`⚠️ Contract ${contractAddress} not found`);
      return;
    }

    // Remove all listeners
    contractData.contract.removeAllListeners();
    this.contracts.delete(normalizedAddress);

    console.log(`✅ Removed NFT contract ${contractAddress}`);
  }

  /**
   * Start listening to all NFT events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`⚠️ NFT Event Listener for chain ${this.config.chainId} is already running`);
      return;
    }

    try {
      console.log(`🎧 Starting NFT Event Listener for chain ${this.config.chainId}`);
      
      // Test connection
      await this.provider.getBlockNumber();
      
      this.isRunning = true;

      // Set up listeners for all contracts
      for (const [address] of this.contracts) {
        await this.setupContractListeners(address);
      }

      console.log(`✅ NFT Event Listener started for chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Failed to start NFT Event Listener for chain ${this.config.chainId}:`, error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop listening to all NFT events
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log(`⚠️ NFT Event Listener for chain ${this.config.chainId} is not running`);
      return;
    }

    try {
      console.log(`🛑 Stopping NFT Event Listener for chain ${this.config.chainId}`);

      // Remove all listeners from all contracts
      this.contracts.forEach((contractData) => {
        contractData.contract.removeAllListeners();
      });

      // Close WebSocket connection if using WebSocket provider
      this.isRunning = false;
      console.log(`✅ NFT Event Listener stopped for chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Error stopping NFT Event Listener for chain ${this.config.chainId}:`, error);
      throw error;
    }
  }

  /**
   * Setup event listeners for a specific contract
   */
  private async setupContractListeners(contractAddress: string): Promise<void> {
    const contractData = this.contracts.get(contractAddress);
    if (!contractData) {
      return;
    }

    const { contract, config } = contractData;
    const currentBlock = await this.provider.getBlockNumber();

    console.log(`🔍 Setting up listeners for ${config.tokenType} contract ${contractAddress} from block ${currentBlock}`);

    // Listen to Transfer events based on token type
    if (config.tokenType === 'ERC721') {
      await this.setupERC721TransferListener(contract, config, currentBlock);
      await this.setupERC721ApprovalListener(contract, config, currentBlock);
    } else {
      await this.setupERC1155TransferListeners(contract, config, currentBlock);
    }

    // ApprovalForAll is common to both ERC721 and ERC1155
    await this.setupApprovalForAllListener(contract, config, currentBlock);
  }

  /**
   * Setup ERC721 Transfer event listener
   * Requirements: 11.1, 11.2, 11.3
   */
  private async setupERC721TransferListener(
    contract: ethers.Contract,
    config: NFTContractConfig,
    currentBlock: number
  ): Promise<void> {
    const filter = contract.filters.Transfer();

    contract.on(filter, async (
      from: string,
      to: string,
      tokenId: bigint,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid Transfer event data for ${config.address}`);
          return;
        }

        // Only process events from current block onwards
        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        const transferData: TransferEventData = {
          contractAddress: config.address,
          tokenId: tokenId.toString(),
          from,
          to,
          quantity: '1', // ERC721 always transfers 1
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          blockTimestamp: new Date(block.timestamp * 1000),
          logIndex: event.index,
          tokenType: 'ERC721'
        };

        await this.handleTransferEvent(transferData);
      } catch (error) {
        console.error(`❌ Error processing ERC721 Transfer event:`, error);
        await this.logError('ERC721_Transfer', error, { config, event });
      }
    });

    console.log(`✅ Listening to ERC721 Transfer events for ${config.address}`);
  }

  /**
   * Setup ERC1155 Transfer event listeners (TransferSingle and TransferBatch)
   * Requirements: 11.1, 11.2, 11.3
   */
  private async setupERC1155TransferListeners(
    contract: ethers.Contract,
    config: NFTContractConfig,
    currentBlock: number
  ): Promise<void> {
    // TransferSingle event
    const singleFilter = contract.filters.TransferSingle();

    contract.on(singleFilter, async (
      operator: string,
      from: string,
      to: string,
      id: bigint,
      value: bigint,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid TransferSingle event data for ${config.address}`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        const transferData: TransferEventData = {
          contractAddress: config.address,
          tokenId: id.toString(),
          from,
          to,
          quantity: value.toString(),
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          blockTimestamp: new Date(block.timestamp * 1000),
          logIndex: event.index,
          tokenType: 'ERC1155'
        };

        await this.handleTransferEvent(transferData);
      } catch (error) {
        console.error(`❌ Error processing ERC1155 TransferSingle event:`, error);
        await this.logError('ERC1155_TransferSingle', error, { config, event });
      }
    });

    // TransferBatch event
    const batchFilter = contract.filters.TransferBatch();

    contract.on(batchFilter, async (
      operator: string,
      from: string,
      to: string,
      ids: bigint[],
      values: bigint[],
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid TransferBatch event data for ${config.address}`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        // Process each transfer in the batch
        for (let i = 0; i < ids.length; i++) {
          const transferData: TransferEventData = {
            contractAddress: config.address,
            tokenId: ids[i].toString(),
            from,
            to,
            quantity: values[i].toString(),
            txHash: event.transactionHash,
            blockNumber: event.blockNumber,
            blockTimestamp: new Date(block.timestamp * 1000),
            logIndex: event.index + i, // Increment log index for each item in batch
            tokenType: 'ERC1155'
          };

          await this.handleTransferEvent(transferData);
        }
      } catch (error) {
        console.error(`❌ Error processing ERC1155 TransferBatch event:`, error);
        await this.logError('ERC1155_TransferBatch', error, { config, event });
      }
    });

    console.log(`✅ Listening to ERC1155 Transfer events for ${config.address}`);
  }

  /**
   * Setup ERC721 Approval event listener
   * Requirements: 8.1, 8.2
   */
  private async setupERC721ApprovalListener(
    contract: ethers.Contract,
    config: NFTContractConfig,
    currentBlock: number
  ): Promise<void> {
    const filter = contract.filters.Approval();

    contract.on(filter, async (
      owner: string,
      approved: string,
      tokenId: bigint,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid Approval event data for ${config.address}`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const approvalData: ApprovalEventData = {
          contractAddress: config.address,
          owner,
          approved,
          tokenId: tokenId.toString(),
          txHash: event.transactionHash,
          blockNumber: event.blockNumber
        };

        await this.handleApprovalEvent(approvalData);
      } catch (error) {
        console.error(`❌ Error processing Approval event:`, error);
        await this.logError('ERC721_Approval', error, { config, event });
      }
    });

    console.log(`✅ Listening to ERC721 Approval events for ${config.address}`);
  }

  /**
   * Setup ApprovalForAll event listener (common to ERC721 and ERC1155)
   * Requirements: 8.1, 8.2
   */
  private async setupApprovalForAllListener(
    contract: ethers.Contract,
    config: NFTContractConfig,
    currentBlock: number
  ): Promise<void> {
    const filter = contract.filters.ApprovalForAll();

    contract.on(filter, async (
      owner: string,
      operator: string,
      approved: boolean,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid ApprovalForAll event data for ${config.address}`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const approvalData: ApprovalForAllEventData = {
          contractAddress: config.address,
          owner,
          operator,
          approved,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber
        };

        await this.handleApprovalForAllEvent(approvalData);
      } catch (error) {
        console.error(`❌ Error processing ApprovalForAll event:`, error);
        await this.logError('ApprovalForAll', error, { config, event });
      }
    });

    console.log(`✅ Listening to ApprovalForAll events for ${config.address}`);
  }

  /**
   * Handle Transfer event - route to NFT Event Handler
   * Requirements: 11.1, 11.2, 11.3
   */
  private async handleTransferEvent(transferData: TransferEventData): Promise<void> {
    try {
      // Determine transfer type
      const transferType = this.determineTransferType(transferData.from, transferData.to);

      console.log(`📦 ${transferType} detected: ${transferData.contractAddress} token ${transferData.tokenId}`);
      console.log(`   From: ${transferData.from} → To: ${transferData.to}`);
      console.log(`   Quantity: ${transferData.quantity}, Block: ${transferData.blockNumber}`);

      // Route to NFT Event Handler if available
      if (this.nftEventHandler) {
        await this.nftEventHandler.handleTransferEvent(transferData);
      } else {
        console.warn(`⚠️ NFT Event Handler not configured, transfer event not processed`);
      }
      
    } catch (error) {
      console.error(`❌ Error handling transfer event:`, error);
      throw error;
    }
  }

  /**
   * Handle Approval event
   * Store approval data for marketplace tracking
   * Requirements: 8.1, 8.2
   */
  private async handleApprovalEvent(approvalData: ApprovalEventData): Promise<void> {
    try {
      console.log(`✅ Approval: ${approvalData.owner} approved ${approvalData.approved} for token ${approvalData.tokenId}`);
      
      // TODO: In task 5, this will be used for marketplace tracking
      // For now, we just log the event
      
    } catch (error) {
      console.error(`❌ Error handling approval event:`, error);
      throw error;
    }
  }

  /**
   * Handle ApprovalForAll event
   * Store approval data for marketplace tracking
   * Requirements: 8.1, 8.2
   */
  private async handleApprovalForAllEvent(approvalData: ApprovalForAllEventData): Promise<void> {
    try {
      console.log(`✅ ApprovalForAll: ${approvalData.owner} ${approvalData.approved ? 'approved' : 'revoked'} ${approvalData.operator}`);
      
      // TODO: In task 5, this will be used for marketplace tracking
      // For now, we just log the event
      
    } catch (error) {
      console.error(`❌ Error handling approval for all event:`, error);
      throw error;
    }
  }

  /**
   * Determine transfer type based on from/to addresses
   * Requirements: 11.2, 11.3
   */
  private determineTransferType(from: string, to: string): TransferType {
    const zeroAddress = ethers.ZeroAddress;
    
    if (from === zeroAddress) {
      return TransferType.MINT;
    } else if (to === zeroAddress) {
      return TransferType.BURN;
    } else {
      return TransferType.TRANSFER;
    }
  }

  /**
   * Log error with context
   */
  private async logError(eventType: string, error: any, context: any): Promise<void> {
    try {
      logError(
        `NFTEventListener.${eventType}`,
        error,
        {
          ...context,
          chainId: this.config.chainId,
          timestamp: new Date()
        },
        'medium'
      );
    } catch (logErr) {
      console.error('Failed to log error:', logErr);
    }
  }

  /**
   * Get listener status
   */
  getStatus(): {
    chainId: number;
    isRunning: boolean;
    contractCount: number;
    contracts: string[];
  } {
    return {
      chainId: this.config.chainId,
      isRunning: this.isRunning,
      contractCount: this.contracts.size,
      contracts: Array.from(this.contracts.keys())
    };
  }
}
