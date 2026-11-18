/**
 * RPC Usage Tracker
 * 
 * Tracks RPC call usage to monitor Alchemy limits
 */

export class RPCUsageTracker {
  private callCount: number = 0;
  private hourlyCount: number = 0;
  private dailyCount: number = 0;
  private lastHourReset: number = Date.now();
  private lastDayReset: number = Date.now();
  private callsByType: Map<string, number> = new Map();

  /**
   * Track an RPC call
   */
  trackCall(callType: string = 'unknown'): void {
    this.callCount++;
    this.hourlyCount++;
    this.dailyCount++;
    
    const current = this.callsByType.get(callType) || 0;
    this.callsByType.set(callType, current + 1);
    
    this.checkResets();
  }

  /**
   * Check if we need to reset hourly/daily counters
   */
  private checkResets(): void {
    const now = Date.now();
    
    // Reset hourly counter
    if (now - this.lastHourReset >= 3600000) { // 1 hour
      console.log(`📊 RPC Usage (last hour): ${this.hourlyCount.toLocaleString()} calls`);
      this.logBreakdown();
      this.hourlyCount = 0;
      this.lastHourReset = now;
    }
    
    // Reset daily counter
    if (now - this.lastDayReset >= 86400000) { // 24 hours
      console.log(`📊 RPC Usage (last 24h): ${this.dailyCount.toLocaleString()} calls`);
      this.logProjection();
      this.dailyCount = 0;
      this.lastDayReset = now;
      this.callsByType.clear();
    }
  }

  /**
   * Log breakdown by call type
   */
  private logBreakdown(): void {
    console.log('   Breakdown by type:');
    const sorted = Array.from(this.callsByType.entries())
      .sort((a, b) => b[1] - a[1]);
    
    for (const [type, count] of sorted) {
      const percentage = ((count / this.hourlyCount) * 100).toFixed(1);
      console.log(`   - ${type}: ${count.toLocaleString()} (${percentage}%)`);
    }
  }

  /**
   * Log monthly projection
   */
  private logProjection(): void {
    const monthlyProjection = this.dailyCount * 30;
    const freeLimit = 300_000_000;
    const percentage = ((monthlyProjection / freeLimit) * 100).toFixed(1);
    
    console.log(`📈 Monthly projection: ${(monthlyProjection / 1_000_000).toFixed(1)}M calls`);
    console.log(`   Alchemy free tier: ${percentage}% used`);
    
    if (monthlyProjection > freeLimit * 0.8) {
      console.warn(`⚠️ WARNING: Approaching Alchemy free tier limit (${percentage}%)`);
      console.warn(`   Consider optimizing polling interval or upgrading plan`);
    } else if (monthlyProjection > freeLimit) {
      console.error(`❌ ERROR: Exceeding Alchemy free tier limit (${percentage}%)`);
      console.error(`   Upgrade to Growth tier or reduce polling frequency`);
    } else {
      console.log(`✅ Well within Alchemy free tier limits`);
    }
  }

  /**
   * Get current statistics
   */
  getStats(): {
    total: number;
    hourly: number;
    daily: number;
    byType: Record<string, number>;
    monthlyProjection: number;
    freePercentage: number;
  } {
    const monthlyProjection = this.dailyCount * 30;
    const freeLimit = 300_000_000;
    
    return {
      total: this.callCount,
      hourly: this.hourlyCount,
      daily: this.dailyCount,
      byType: Object.fromEntries(this.callsByType),
      monthlyProjection,
      freePercentage: (monthlyProjection / freeLimit) * 100
    };
  }

  /**
   * Log current stats
   */
  logStats(): void {
    const stats = this.getStats();
    console.log('📊 RPC Usage Statistics:');
    console.log(`   Total calls: ${stats.total.toLocaleString()}`);
    console.log(`   Last hour: ${stats.hourly.toLocaleString()}`);
    console.log(`   Last 24h: ${stats.daily.toLocaleString()}`);
    console.log(`   Monthly projection: ${(stats.monthlyProjection / 1_000_000).toFixed(1)}M`);
    console.log(`   Free tier usage: ${stats.freePercentage.toFixed(1)}%`);
  }
}

// Singleton instance
export const rpcUsageTracker = new RPCUsageTracker();
