/**
 * Phase Index Verification Service
 * 
 * Verifies phase index consistency between database and smart contracts.
 * Ensures that phaseIndex in database matches the array index in contract.
 * 
 * Requirements: 5.1, 8.2
 */

import { ethers } from 'ethers';
import { prisma } from '../../../config/database';
import { ProviderService } from './provider-service';
import OddsLaunchpadABI from '../../../../abi/OddsLaunchpad.json';

/**
 * Verification report for all collections
 */
export interface VerificationReport {
  totalCollections: number;
  collectionsChecked: number;
  mismatches: CollectionMismatch[];
  orphanedWhitelists: OrphanedWhitelistReport[];
  summary: {
    consistent: number;
    inconsistent: number;
    errors: number;
    orphanedWhitelistRecords: number;
  };
}

/**
 * Orphaned whitelist report for a collection
 */
export interface OrphanedWhitelistReport {
  contractAddress: string;
  collectionName: string;
  chainId: number;
  orphanedRecords: OrphanedWhitelistRecord[];
}

/**
 * Individual orphaned whitelist record
 */
export interface OrphanedWhitelistRecord {
  phaseId: number;
  addressCount: number;
  addresses: string[];
}

/**
 * Mismatch details for a single collection
 */
export interface CollectionMismatch {
  contractAddress: string;
  collectionName: string;
  chainId: number;
  issues: PhaseIndexIssue[];
}

/**
 * Individual phase index issue
 */
export interface PhaseIndexIssue {
  phaseName: string;
  expectedIndex: number;  // From contract
  actualIndex: number;    // From database
  severity: 'critical' | 'warning';
  description: string;
}

/**
 * Verification result for a single collection
 */
export interface CollectionVerification {
  contractAddress: string;
  consistent: boolean;
  contractPhaseCount: number;
  databasePhaseCount: number;
  phases: PhaseComparison[];
  orphanedWhitelists?: OrphanedWhitelistRecord[];
}

/**
 * Comparison of a single phase
 */
export interface PhaseComparison {
  contractIndex: number;
  databaseIndex: number | null;
  phaseName: string;
  matches: boolean;
}

/**
 * Result of repair operation
 */
export interface RepairResult {
  success: boolean;
  phasesRepaired: number;
  errors: string[];
}

/**
 * Phase Index Verification Service
 * 
 * Validates: Requirements 5.1, 8.2
 */
export class PhaseIndexVerificationService {
  /**
   * Verify all collections for phase index consistency
   * 
   * @param chainId - Chain ID to verify collections on
   * @returns Verification report with all mismatches
   */
  async verifyAllCollections(chainId: number): Promise<VerificationReport> {
    console.log(`🔍 Starting phase index verification for chain ${chainId}`);

    const report: VerificationReport = {
      totalCollections: 0,
      collectionsChecked: 0,
      mismatches: [],
      orphanedWhitelists: [],
      summary: {
        consistent: 0,
        inconsistent: 0,
        errors: 0,
        orphanedWhitelistRecords: 0
      }
    };

    try {
      // Get all launchpads for this chain
      const launchpads = await prisma.launchpad.findMany({
        where: { chainId },
        select: {
          id: true,
          contractAddress: true,
          name: true,
          chainId: true
        }
      });

      report.totalCollections = launchpads.length;
      console.log(`📊 Found ${launchpads.length} collections to verify`);

      // Verify each collection
      for (const launchpad of launchpads) {
        try {
          const verification = await this.verifyCollection(
            launchpad.chainId,
            launchpad.contractAddress
          );

          report.collectionsChecked++;

          if (!verification.consistent) {
            // Found mismatches
            const issues: PhaseIndexIssue[] = verification.phases
              .filter(p => !p.matches)
              .map(p => ({
                phaseName: p.phaseName,
                expectedIndex: p.contractIndex,
                actualIndex: p.databaseIndex ?? -1,
                severity: 'critical' as const,
                description: p.databaseIndex === null
                  ? `Phase exists in contract at index ${p.contractIndex} but not found in database`
                  : `Phase index mismatch: contract has ${p.contractIndex}, database has ${p.databaseIndex}`
              }));

            report.mismatches.push({
              contractAddress: launchpad.contractAddress,
              collectionName: launchpad.name,
              chainId: launchpad.chainId,
              issues
            });

            report.summary.inconsistent++;
          } else {
            report.summary.consistent++;
          }

          // Check for orphaned whitelist records
          if (verification.orphanedWhitelists && verification.orphanedWhitelists.length > 0) {
            report.orphanedWhitelists.push({
              contractAddress: launchpad.contractAddress,
              collectionName: launchpad.name,
              chainId: launchpad.chainId,
              orphanedRecords: verification.orphanedWhitelists
            });

            const totalOrphaned = verification.orphanedWhitelists.reduce(
              (sum, record) => sum + record.addressCount,
              0
            );
            report.summary.orphanedWhitelistRecords += totalOrphaned;

            console.warn(`⚠️ Found ${verification.orphanedWhitelists.length} orphaned whitelist phase(s) with ${totalOrphaned} total addresses`);
          }
        } catch (error) {
          console.error(`❌ Error verifying collection ${launchpad.contractAddress}:`, error);
          report.summary.errors++;
        }
      }

      console.log(`✅ Verification complete: ${report.summary.consistent} consistent, ${report.summary.inconsistent} inconsistent, ${report.summary.errors} errors`);

      return report;
    } catch (error) {
      console.error(`❌ Error during verification:`, error);
      throw error;
    }
  }

  /**
   * Verify a single collection for phase index consistency
   * 
   * @param chainId - Chain ID of the collection
   * @param contractAddress - Contract address of the collection
   * @returns Verification result with phase comparisons
   */
  async verifyCollection(
    chainId: number,
    contractAddress: string
  ): Promise<CollectionVerification> {
    console.log(`🔍 Verifying collection ${contractAddress} on chain ${chainId}`);

    // Normalize contract address
    const normalizedAddress = ethers.getAddress(contractAddress);

    // Get launchpad from database
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        chainId,
        contractAddress: normalizedAddress
      },
      include: {
        phases: {
          orderBy: { phaseIndex: 'asc' }
        }
      }
    });

    if (!launchpad) {
      throw new Error(`Launchpad not found: ${normalizedAddress} on chain ${chainId}`);
    }

    // Get RPC URL for this chain
    const rpcUrl = this.getRpcUrl(chainId);
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }

    // Create provider and contract instance
    const providerService = new ProviderService(rpcUrl, chainId);
    const provider = providerService.getProvider();
    const contract = new ethers.Contract(
      normalizedAddress,
      OddsLaunchpadABI as any,
      provider
    );

    try {
      // Get phase count from contract
      const phaseCount = await contract.allPhasesCount();
      const contractPhaseCount = Number(phaseCount);

      console.log(`📊 Contract has ${contractPhaseCount} phases, database has ${launchpad.phases.length} phases`);

      // Get all phases from contract
      const contractPhases: Array<{ index: number; name: string }> = [];
      for (let i = 0; i < contractPhaseCount; i++) {
        try {
          const phase = await contract.getMintPhase(i);
          contractPhases.push({
            index: i,
            name: phase.name
          });
        } catch (error) {
          console.error(`⚠️ Error fetching phase ${i} from contract:`, error);
          contractPhases.push({
            index: i,
            name: `<Error fetching phase ${i}>`
          });
        }
      }

      // Compare phases
      const phases: PhaseComparison[] = [];
      let consistent = true;

      for (const contractPhase of contractPhases) {
        // Find corresponding database phase
        const dbPhase = launchpad.phases.find(
          p => p.phaseIndex === contractPhase.index
        );

        const matches = dbPhase !== undefined && dbPhase.phaseIndex === contractPhase.index;
        
        if (!matches) {
          consistent = false;
        }

        phases.push({
          contractIndex: contractPhase.index,
          databaseIndex: dbPhase?.phaseIndex ?? null,
          phaseName: contractPhase.name,
          matches
        });
      }

      // Check for extra phases in database that don't exist in contract
      for (const dbPhase of launchpad.phases) {
        if (dbPhase.phaseIndex >= contractPhaseCount) {
          consistent = false;
          phases.push({
            contractIndex: -1,
            databaseIndex: dbPhase.phaseIndex,
            phaseName: dbPhase.name,
            matches: false
          });
        }
      }

      const result: CollectionVerification = {
        contractAddress: normalizedAddress,
        consistent,
        contractPhaseCount,
        databasePhaseCount: launchpad.phases.length,
        phases
      };

      // Check for orphaned whitelist records
      // Requirements: 7.5
      const validPhaseIndices = launchpad.phases.map(p => p.phaseIndex);
      const orphanedWhitelists = await this.detectOrphanedWhitelists(
        launchpad.id,
        validPhaseIndices
      );

      if (orphanedWhitelists.length > 0) {
        result.orphanedWhitelists = orphanedWhitelists;
        
        const totalOrphaned = orphanedWhitelists.reduce(
          (sum, record) => sum + record.addressCount,
          0
        );

        console.warn(`⚠️ Found ${orphanedWhitelists.length} orphaned whitelist phase(s) for collection ${normalizedAddress}`);
        orphanedWhitelists.forEach(orphaned => {
          console.warn(`   - Phase ID ${orphaned.phaseId}: ${orphaned.addressCount} addresses`);
          console.warn(`     Addresses: ${orphaned.addresses.slice(0, 3).join(', ')}${orphaned.addresses.length > 3 ? '...' : ''}`);
        });
      }

      if (consistent) {
        console.log(`✅ Collection ${normalizedAddress} is consistent`);
      } else {
        console.warn(`⚠️ Collection ${normalizedAddress} has phase index mismatches`);
        phases.filter(p => !p.matches).forEach(p => {
          console.warn(`   - Phase "${p.phaseName}": contract index ${p.contractIndex}, database index ${p.databaseIndex}`);
        });
      }

      return result;
    } finally {
      // Clean up provider
      await providerService.destroy();
    }
  }

  /**
   * Repair phase indices for a collection by re-syncing from contract
   * 
   * This method includes:
   * - Validation to ensure repair doesn't introduce new issues
   * - Rollback mechanism in case repair fails
   * - Post-repair verification
   * 
   * Requirements: 8.4
   * 
   * @param chainId - Chain ID of the collection
   * @param contractAddress - Contract address of the collection
   * @returns Repair result with success status and errors
   */
  async repairCollection(
    chainId: number,
    contractAddress: string
  ): Promise<RepairResult> {
    console.log(`🔧 Repairing collection ${contractAddress} on chain ${chainId}`);

    const result: RepairResult = {
      success: false,
      phasesRepaired: 0,
      errors: []
    };

    let backupPhases: any[] = [];

    try {
      // Normalize contract address
      const normalizedAddress = ethers.getAddress(contractAddress);

      // Get launchpad from database
      const launchpad = await prisma.launchpad.findFirst({
        where: {
          chainId,
          contractAddress: normalizedAddress
        },
        include: {
          phases: {
            orderBy: { phaseIndex: 'asc' }
          }
        }
      });

      if (!launchpad) {
        result.errors.push(`Launchpad not found: ${normalizedAddress} on chain ${chainId}`);
        return result;
      }

      // Backup existing phases for rollback
      backupPhases = launchpad.phases.map(phase => ({
        id: phase.id,
        launchpadId: phase.launchpadId,
        phaseIndex: phase.phaseIndex,
        name: phase.name,
        phaseType: phase.phaseType,
        startTime: phase.startTime,
        endTime: phase.endTime,
        price: phase.price,
        maxMintPerWallet: phase.maxMintPerWallet,
        totalLimit: phase.totalLimit,
        mintedCount: phase.mintedCount,
        isActive: phase.isActive,
        merkleRoot: phase.merkleRoot
      }));

      console.log(`💾 Backed up ${backupPhases.length} existing phases for rollback`);

      // Get RPC URL for this chain
      const rpcUrl = this.getRpcUrl(chainId);
      if (!rpcUrl) {
        result.errors.push(`No RPC URL configured for chain ${chainId}`);
        return result;
      }

      // Create provider and contract instance
      const providerService = new ProviderService(rpcUrl, chainId);
      const provider = providerService.getProvider();
      const contract = new ethers.Contract(
        normalizedAddress,
        OddsLaunchpadABI as any,
        provider
      );

      try {
        // Get phase count from contract
        const phaseCount = await contract.allPhasesCount();
        const contractPhaseCount = Number(phaseCount);

        console.log(`📊 Contract has ${contractPhaseCount} phases`);

        // Validation: Ensure contract has phases
        if (contractPhaseCount === 0) {
          result.errors.push('Contract has no phases to sync');
          return result;
        }

        // Get all phases from contract
        const contractPhases: any[] = [];
        for (let i = 0; i < contractPhaseCount; i++) {
          try {
            const phase = await contract.getMintPhase(i);
            contractPhases.push({
              index: i,
              name: phase.name,
              startTime: new Date(Number(phase.startTime) * 1000),
              endTime: new Date(Number(phase.endTime) * 1000),
              price: phase.price.toString(),
              maxMintPerWallet: Number(phase.maxMintPerWallet),
              totalLimit: Number(phase.maxSupply),
              isActive: phase.isActive
            });
          } catch (error) {
            result.errors.push(`Error fetching phase ${i} from contract: ${error}`);
          }
        }

        if (result.errors.length > 0) {
          console.error(`❌ Failed to fetch all phases from contract`);
          return result;
        }

        // Validation: Ensure phases have sequential indices
        const hasGaps = contractPhases.some((phase, idx) => phase.index !== idx);
        if (hasGaps) {
          result.errors.push('Contract phases have non-sequential indices');
          console.error(`❌ Contract phases have non-sequential indices:`, 
            contractPhases.map(p => `${p.index}: ${p.name}`));
          return result;
        }

        // Validation: Ensure all phases have valid data
        for (const phase of contractPhases) {
          if (!phase.name || phase.name.trim() === '') {
            result.errors.push(`Phase ${phase.index} has empty name`);
          }
          if (phase.startTime >= phase.endTime) {
            result.errors.push(`Phase ${phase.index} has invalid time range`);
          }
          if (phase.maxMintPerWallet <= 0) {
            result.errors.push(`Phase ${phase.index} has invalid maxMintPerWallet`);
          }
          if (phase.totalLimit <= 0) {
            result.errors.push(`Phase ${phase.index} has invalid totalLimit`);
          }
        }

        if (result.errors.length > 0) {
          console.error(`❌ Validation failed for contract phases`);
          return result;
        }

        console.log(`✅ Pre-repair validation passed`);

        // Use transaction to ensure atomic update with rollback capability
        try {
          await prisma.$transaction(async (tx) => {
            // Delete existing phases
            await tx.launchpadPhase.deleteMany({
              where: { launchpadId: launchpad.id }
            });

            console.log(`🗑️ Deleted ${backupPhases.length} existing phases`);

            // Create new phases with correct indices
            for (const phase of contractPhases) {
              // Determine phase type
              let phaseType: 'PRESALE' | 'PUBLIC' | 'ALLOWLIST' | 'FREE' = 'PUBLIC';
              const nameLower = phase.name.toLowerCase();
              if (BigInt(phase.price) === BigInt(0)) {
                phaseType = 'FREE';
              } else if (nameLower.includes('presale') || nameLower.includes('pre-sale')) {
                phaseType = 'PRESALE';
              } else if (nameLower.includes('allowlist') || nameLower.includes('whitelist')) {
                phaseType = 'ALLOWLIST';
              }

              await tx.launchpadPhase.create({
                data: {
                  launchpadId: launchpad.id,
                  phaseIndex: phase.index,
                  name: phase.name,
                  phaseType,
                  startTime: phase.startTime,
                  endTime: phase.endTime,
                  price: phase.price,
                  maxMintPerWallet: phase.maxMintPerWallet,
                  totalLimit: phase.totalLimit,
                  mintedCount: 0,
                  isActive: phase.isActive
                }
              });
            }

            console.log(`✅ Created ${contractPhases.length} new phases`);

            // Post-repair validation: Verify phases were created correctly
            const createdPhases = await tx.launchpadPhase.findMany({
              where: { launchpadId: launchpad.id },
              orderBy: { phaseIndex: 'asc' }
            });

            // Validate created phases
            if (createdPhases.length !== contractPhases.length) {
              throw new Error(
                `Phase count mismatch after repair: expected ${contractPhases.length}, got ${createdPhases.length}`
              );
            }

            // Validate sequential indices
            const hasGapsAfterRepair = createdPhases.some((phase, idx) => phase.phaseIndex !== idx);
            if (hasGapsAfterRepair) {
              throw new Error(
                `Non-sequential indices detected after repair: ${createdPhases.map(p => p.phaseIndex).join(', ')}`
              );
            }

            // Validate each phase matches contract data
            for (let i = 0; i < createdPhases.length; i++) {
              const dbPhase = createdPhases[i];
              const contractPhase = contractPhases[i];

              if (dbPhase.phaseIndex !== contractPhase.index) {
                throw new Error(
                  `Phase index mismatch at position ${i}: database has ${dbPhase.phaseIndex}, contract has ${contractPhase.index}`
                );
              }

              if (dbPhase.name !== contractPhase.name) {
                throw new Error(
                  `Phase name mismatch at index ${i}: database has "${dbPhase.name}", contract has "${contractPhase.name}"`
                );
              }
            }

            console.log(`✅ Post-repair validation passed`);
          });

          result.success = true;
          result.phasesRepaired = contractPhases.length;
          console.log(`✅ Successfully repaired ${contractPhases.length} phases for collection ${normalizedAddress}`);

        } catch (transactionError) {
          // Transaction failed, rollback will happen automatically
          console.error(`❌ Transaction failed, rolling back:`, transactionError);
          result.errors.push(`Repair transaction failed: ${transactionError}`);
          
          // Attempt manual rollback if needed
          try {
            console.log(`🔄 Attempting manual rollback of ${backupPhases.length} phases`);
            
            await prisma.$transaction(async (tx) => {
              // Delete any phases that might have been created
              await tx.launchpadPhase.deleteMany({
                where: { launchpadId: launchpad.id }
              });

              // Restore backup phases
              for (const backupPhase of backupPhases) {
                await tx.launchpadPhase.create({
                  data: {
                    launchpadId: backupPhase.launchpadId,
                    phaseIndex: backupPhase.phaseIndex,
                    name: backupPhase.name,
                    phaseType: backupPhase.phaseType,
                    startTime: backupPhase.startTime,
                    endTime: backupPhase.endTime,
                    price: backupPhase.price,
                    maxMintPerWallet: backupPhase.maxMintPerWallet,
                    totalLimit: backupPhase.totalLimit,
                    mintedCount: backupPhase.mintedCount,
                    isActive: backupPhase.isActive,
                    merkleRoot: backupPhase.merkleRoot
                  }
                });
              }
            });

            console.log(`✅ Manual rollback successful, restored ${backupPhases.length} phases`);
            result.errors.push(`Rollback successful: restored ${backupPhases.length} original phases`);
          } catch (rollbackError) {
            console.error(`❌ Manual rollback failed:`, rollbackError);
            result.errors.push(`Rollback failed: ${rollbackError}`);
            result.errors.push(`CRITICAL: Database may be in inconsistent state for collection ${normalizedAddress}`);
          }

          return result;
        }

      } finally {
        // Clean up provider
        await providerService.destroy();
      }

      return result;
    } catch (error) {
      console.error(`❌ Error repairing collection:`, error);
      result.errors.push(`Repair failed: ${error}`);
      
      // Attempt rollback on unexpected error
      if (backupPhases.length > 0) {
        try {
          console.log(`🔄 Attempting rollback after unexpected error`);
          
          const launchpad = await prisma.launchpad.findFirst({
            where: {
              chainId,
              contractAddress: ethers.getAddress(contractAddress)
            }
          });

          if (launchpad) {
            await prisma.$transaction(async (tx) => {
              await tx.launchpadPhase.deleteMany({
                where: { launchpadId: launchpad.id }
              });

              for (const backupPhase of backupPhases) {
                await tx.launchpadPhase.create({
                  data: {
                    launchpadId: backupPhase.launchpadId,
                    phaseIndex: backupPhase.phaseIndex,
                    name: backupPhase.name,
                    phaseType: backupPhase.phaseType,
                    startTime: backupPhase.startTime,
                    endTime: backupPhase.endTime,
                    price: backupPhase.price,
                    maxMintPerWallet: backupPhase.maxMintPerWallet,
                    totalLimit: backupPhase.totalLimit,
                    mintedCount: backupPhase.mintedCount,
                    isActive: backupPhase.isActive,
                    merkleRoot: backupPhase.merkleRoot
                  }
                });
              }
            });

            console.log(`✅ Rollback successful after unexpected error`);
            result.errors.push(`Rollback successful: restored ${backupPhases.length} original phases`);
          }
        } catch (rollbackError) {
          console.error(`❌ Rollback failed after unexpected error:`, rollbackError);
          result.errors.push(`Rollback failed: ${rollbackError}`);
        }
      }

      return result;
    }
  }

  /**
   * Detect orphaned whitelist records for a launchpad
   * 
   * Orphaned whitelist records are records that reference a phaseId
   * that doesn't exist in the LaunchpadPhase table.
   * 
   * Requirements: 7.5
   * 
   * @param launchpadId - Launchpad ID
   * @param validPhaseIndices - Array of valid phase indices
   * @returns Array of orphaned whitelist records grouped by phaseId
   */
  private async detectOrphanedWhitelists(
    launchpadId: string,
    validPhaseIndices: number[]
  ): Promise<OrphanedWhitelistRecord[]> {
    // Find all whitelist records for this launchpad
    const allWhitelists = await prisma.launchpadWhitelist.findMany({
      where: { launchpadId },
      select: {
        phaseId: true,
        address: true
      }
    });

    // Group by phaseId
    const whitelistsByPhase = new Map<number, string[]>();
    for (const whitelist of allWhitelists) {
      if (!whitelistsByPhase.has(whitelist.phaseId)) {
        whitelistsByPhase.set(whitelist.phaseId, []);
      }
      whitelistsByPhase.get(whitelist.phaseId)!.push(whitelist.address);
    }

    // Find orphaned records (phaseId not in validPhaseIndices)
    const orphanedRecords: OrphanedWhitelistRecord[] = [];
    const entries = Array.from(whitelistsByPhase.entries());
    for (const [phaseId, addresses] of entries) {
      if (!validPhaseIndices.includes(phaseId)) {
        orphanedRecords.push({
          phaseId,
          addressCount: addresses.length,
          addresses
        });
      }
    }

    return orphanedRecords;
  }

  /**
   * Clean up orphaned whitelist records for a launchpad
   * 
   * Removes whitelist records that reference non-existent phaseIndex values.
   * 
   * Requirements: 7.5
   * 
   * @param launchpadId - Launchpad ID
   * @param validPhaseIndices - Array of valid phase indices
   * @returns Number of records deleted
   */
  async cleanupOrphanedWhitelists(
    launchpadId: string,
    validPhaseIndices: number[]
  ): Promise<number> {
    console.log(`🧹 Cleaning up orphaned whitelist records for launchpad ${launchpadId}`);

    // Delete whitelist records with phaseId not in validPhaseIndices
    const result = await prisma.launchpadWhitelist.deleteMany({
      where: {
        launchpadId,
        phaseId: {
          notIn: validPhaseIndices
        }
      }
    });

    console.log(`✅ Deleted ${result.count} orphaned whitelist records`);
    return result.count;
  }

  /**
   * Clean up orphaned whitelist records for a collection
   * 
   * Public method to clean up orphaned whitelists by contract address.
   * 
   * Requirements: 7.5
   * 
   * @param chainId - Chain ID of the collection
   * @param contractAddress - Contract address of the collection
   * @returns Number of records deleted
   */
  async cleanupOrphanedWhitelistsByCollection(
    chainId: number,
    contractAddress: string
  ): Promise<{ success: boolean; deletedCount: number; errors: string[] }> {
    console.log(`🧹 Cleaning up orphaned whitelists for collection ${contractAddress} on chain ${chainId}`);

    const result = {
      success: false,
      deletedCount: 0,
      errors: [] as string[]
    };

    try {
      // Normalize contract address
      const normalizedAddress = ethers.getAddress(contractAddress);

      // Get launchpad from database
      const launchpad = await prisma.launchpad.findFirst({
        where: {
          chainId,
          contractAddress: normalizedAddress
        },
        include: {
          phases: {
            select: { phaseIndex: true }
          }
        }
      });

      if (!launchpad) {
        result.errors.push(`Launchpad not found: ${normalizedAddress} on chain ${chainId}`);
        return result;
      }

      // Get valid phase indices
      const validPhaseIndices = launchpad.phases.map(p => p.phaseIndex);

      // Clean up orphaned whitelists
      result.deletedCount = await this.cleanupOrphanedWhitelists(
        launchpad.id,
        validPhaseIndices
      );

      result.success = true;
      console.log(`✅ Successfully cleaned up ${result.deletedCount} orphaned whitelist records`);

      return result;
    } catch (error) {
      console.error(`❌ Error cleaning up orphaned whitelists:`, error);
      result.errors.push(`Cleanup failed: ${error}`);
      return result;
    }
  }

  /**
   * Get RPC URL for a chain ID
   * 
   * @param chainId - Chain ID
   * @returns RPC URL or null if not configured
   */
  private getRpcUrl(chainId: number): string | null {
    // Map chain IDs to environment variables
    const rpcEnvMap: Record<number, string> = {
      1: 'ETHEREUM_RPC_URL',
      11155111: 'SEPOLIA_RPC_URL',
      6343: 'MEGAETH_RPC_URL',
      42161: 'ARBITRUM_RPC_URL',
      10: 'OPTIMISM_RPC_URL',
      8453: 'BASE_RPC_URL',
      137: 'POLYGON_RPC_URL'
    };

    const envVar = rpcEnvMap[chainId];
    if (!envVar) {
      console.warn(`⚠️ No RPC environment variable mapping for chain ${chainId}`);
      return null;
    }

    const rpcUrl = process.env[envVar];
    if (!rpcUrl) {
      console.warn(`⚠️ Environment variable ${envVar} not set for chain ${chainId}`);
      return null;
    }

    return rpcUrl;
  }
}
