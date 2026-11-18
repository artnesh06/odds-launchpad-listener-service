/**
 * Event Listener Registry
 * Manages registration of all blockchain event listeners
 * Reduces code duplication by using generic listener setup
 */

import { ethers } from 'ethers';
import { delay } from '../utils/validation-helpers';

export interface EventListenerSetup<THandler> {
  eventName: string;
  filterFactory: (contract: ethers.Contract) => ethers.ContractEventName;
  handler: THandler;
  enabled: boolean;
}

export class EventListenerRegistry {
  private chainId: number;
  private setupDelay: number;

  constructor(chainId: number, setupDelay: number) {
    this.chainId = chainId;
    this.setupDelay = setupDelay;
  }

  /**
   * Setup event listeners for multiple launchpad contracts
   * Generic method to reduce code duplication
   */
  async setupLaunchpadEventListeners<T extends any[]>(
    eventName: string,
    contracts: Map<string, ethers.Contract>,
    filterFactory: (contract: ethers.Contract) => ethers.ContractEventName,
    handler: (address: string, currentBlock: number, ...args: [...T, ethers.EventLog]) => Promise<void>,
    currentBlock: number
  ): Promise<void> {
    let index = 0;

    for (const [address, contract] of contracts.entries()) {
      if (index > 0) {
        await delay(this.setupDelay);
      }

      try {
        const filter = filterFactory(contract);
        
        contract.on(filter, async (...args: [...T, ethers.EventLog]) => {
          try {
            const event = args[args.length - 1] as ethers.EventLog;
            
            if (!event?.blockNumber || !event?.transactionHash) {
              console.warn(`⚠️ Invalid event data for ${eventName} on ${address}`);
              return;
            }
            
            if (event.blockNumber >= currentBlock) {
              await handler(address, currentBlock, ...args);
            }
          } catch (handlerError) {
            console.error(`❌ Error processing ${eventName} event on ${address}:`, handlerError);
          }
        });

        index++;
      } catch (error) {
        console.error(`❌ Error setting up ${eventName} listener for ${address}:`, error);
      }
    }

    console.log(`✅ Listening to NEW ${eventName} events on chain ${this.chainId} (from block ${currentBlock})`);
  }

  /**
   * Setup simple launchpad event listener (for events with standard structure)
   */
  async setupSimpleLaunchpadListener(
    eventName: string,
    contracts: Map<string, ethers.Contract>,
    filterFactory: (contract: ethers.Contract) => ethers.ContractEventName,
    handler: (eventData: any) => Promise<void>,
    currentBlock: number,
    argsExtractor: (args: any[], address: string) => any
  ): Promise<void> {
    let index = 0;

    for (const [address, contract] of contracts.entries()) {
      if (index > 0) {
        await delay(this.setupDelay);
      }

      try {
        const filter = filterFactory(contract);
        
        contract.on(filter, async (...args: any[]) => {
          try {
            const event = args[args.length - 1] as ethers.EventLog;
            
            if (!event?.blockNumber || !event?.transactionHash) {
              console.warn(`⚠️ Invalid event data for ${eventName} on ${address}`);
              return;
            }
            
            if (event.blockNumber >= currentBlock) {
              const eventData = argsExtractor(args, address);
              await handler(eventData);
            }
          } catch (handlerError) {
            console.error(`❌ Error processing ${eventName} event on ${address}:`, handlerError);
          }
        });

        index++;
      } catch (error) {
        console.error(`❌ Error setting up ${eventName} listener for ${address}:`, error);
      }
    }

    console.log(`✅ Listening to NEW ${eventName} events on chain ${this.chainId} (from block ${currentBlock})`);
  }
}
