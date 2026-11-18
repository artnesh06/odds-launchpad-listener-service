/**
 * Format Helpers
 * 
 * Utility functions for formatting blockchain data for display
 */

import { ethers } from 'ethers';

/**
 * Format wei value to ether string
 * @param weiValue - Value in wei (as string or bigint)
 * @param decimals - Number of decimal places to show (default: 4)
 * @returns Formatted ether value as string
 * 
 * @example
 * formatWeiToEther('100000000000000') // '0.0001'
 * formatWeiToEther('10000000000000000') // '0.01'
 * formatWeiToEther('1000000000000000000') // '1.0'
 */
export function formatWeiToEther(weiValue: string | bigint, decimals: number = 4): string {
  try {
    const etherValue = ethers.formatEther(weiValue);
    const num = parseFloat(etherValue);
    
    // If value is 0, return '0'
    if (num === 0) {
      return '0';
    }
    
    // If value is very small, show more decimals
    if (num < 0.0001) {
      return num.toFixed(8).replace(/\.?0+$/, '');
    }
    
    // Otherwise use specified decimals
    return num.toFixed(decimals).replace(/\.?0+$/, '');
  } catch (error) {
    console.error('Error formatting wei to ether:', error);
    return '0';
  }
}

/**
 * Format wei value to gwei string
 * @param weiValue - Value in wei (as string or bigint)
 * @param decimals - Number of decimal places to show (default: 2)
 * @returns Formatted gwei value as string
 * 
 * @example
 * formatWeiToGwei('1000000000') // '1'
 * formatWeiToGwei('1500000000') // '1.5'
 */
export function formatWeiToGwei(weiValue: string | bigint, decimals: number = 2): string {
  try {
    const gweiValue = ethers.formatUnits(weiValue, 'gwei');
    const num = parseFloat(gweiValue);
    
    if (num === 0) {
      return '0';
    }
    
    return num.toFixed(decimals).replace(/\.?0+$/, '');
  } catch (error) {
    console.error('Error formatting wei to gwei:', error);
    return '0';
  }
}

/**
 * Format price with appropriate unit (ETH, Gwei, or Wei)
 * Automatically chooses the best unit based on value size
 * 
 * @param weiValue - Value in wei (as string or bigint)
 * @returns Formatted price with unit
 * 
 * @example
 * formatPriceWithUnit('100000000000000') // '0.0001 ETH'
 * formatPriceWithUnit('1000000000') // '1 Gwei'
 * formatPriceWithUnit('1000') // '1000 Wei'
 */
export function formatPriceWithUnit(weiValue: string | bigint): string {
  try {
    const wei = BigInt(weiValue);
    
    // If 0, return '0 ETH'
    if (wei === 0n) {
      return 'Free';
    }
    
    // If >= 0.001 ETH (1000000000000000 wei), show in ETH
    if (wei >= 1000000000000000n) {
      return `${formatWeiToEther(weiValue)} ETH`;
    }
    
    // If >= 1 Gwei (1000000000 wei), show in Gwei
    if (wei >= 1000000000n) {
      return `${formatWeiToGwei(weiValue)} Gwei`;
    }
    
    // Otherwise show in Wei
    return `${wei.toString()} Wei`;
  } catch (error) {
    console.error('Error formatting price with unit:', error);
    return '0 ETH';
  }
}

/**
 * Format phase data for API response
 * Converts price from wei to ether and adds formatted price field
 */
export function formatPhaseForApi(phase: any): any {
  return {
    ...phase,
    priceWei: phase.price, // Keep original wei value
    priceEther: formatWeiToEther(phase.price), // Add ether value
    priceFormatted: formatPriceWithUnit(phase.price), // Add formatted with unit
  };
}

/**
 * Format launchpad data for API response
 * Converts all price fields and adds formatted versions
 */
export function formatLaunchpadForApi(launchpad: any): any {
  const formatted: any = {
    ...launchpad,
  };
  
  // Format phases if present
  if (launchpad.phases && Array.isArray(launchpad.phases)) {
    formatted.phases = launchpad.phases.map(formatPhaseForApi);
  }
  
  // Format volume if present
  if (launchpad.volume) {
    formatted.volumeWei = launchpad.volume;
    formatted.volumeEther = formatWeiToEther(launchpad.volume);
    formatted.volumeFormatted = formatPriceWithUnit(launchpad.volume);
  }
  
  return formatted;
}
