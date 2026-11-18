/**
 * Test script for WebSocket health check endpoint
 * 
 * Usage: npx tsx scripts/test-health-endpoint.ts
 */

async function testHealthEndpoint() {
  const port = process.env.PORT || '3000';
  const url = `http://localhost:${port}/health/websocket`;

  console.log('🔍 Testing WebSocket health check endpoint...');
  console.log(`📍 URL: ${url}\n`);

  try {
    const response = await fetch(url);
    const data = await response.json() as any;

    console.log('✅ Response Status:', response.status);
    console.log('📊 Health Data:\n');
    console.log(JSON.stringify(data, null, 2));

    if (data.status === 'healthy') {
      console.log('\n✅ WebSocket server is healthy!');
      console.log(`📊 Active Connections: ${data.connections.active}/${data.connections.max}`);
      console.log(`🏠 Active Rooms: ${data.rooms.count}`);
      console.log(`⏱️  Uptime: ${data.uptime.minutes} minutes`);
      console.log(`💾 Memory: ${data.memory.heapUsedMB}MB / ${data.memory.heapTotalMB}MB`);
    } else if (data.status === 'unavailable') {
      console.log('\n⚠️  WebSocket server not initialized');
    } else {
      console.log('\n❌ WebSocket server is unhealthy');
    }
  } catch (error) {
    console.error('❌ Error testing health endpoint:', error);
    console.error('\n💡 Make sure the service is running:');
    console.error('   npm run dev');
  }
}

testHealthEndpoint();
