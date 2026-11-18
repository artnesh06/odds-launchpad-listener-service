import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyProcessedEventModel() {
  try {
    console.log('🔍 Verifying ProcessedEvent model...\n');

    // Test 1: Create a processed event
    console.log('1️⃣ Creating a test processed event...');
    const testEvent = await prisma.processedEvent.create({
      data: {
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        logIndex: 0,
      },
    });
    console.log('✅ Created:', testEvent);

    // Test 2: Query the event
    console.log('\n2️⃣ Querying the created event...');
    const foundEvent = await prisma.processedEvent.findUnique({
      where: {
        transactionHash_logIndex: {
          transactionHash: testEvent.transactionHash,
          logIndex: testEvent.logIndex,
        },
      },
    });
    console.log('✅ Found:', foundEvent);

    // Test 3: Try to create a duplicate (should fail)
    console.log('\n3️⃣ Testing unique constraint (should fail)...');
    try {
      await prisma.processedEvent.create({
        data: {
          transactionHash: testEvent.transactionHash,
          logIndex: testEvent.logIndex,
        },
      });
      console.log('❌ Unique constraint did not work!');
    } catch (error: any) {
      if (error.code === 'P2002') {
        console.log('✅ Unique constraint working correctly!');
      } else {
        throw error;
      }
    }

    // Test 4: Query by processedAt index
    console.log('\n4️⃣ Testing processedAt index...');
    const recentEvents = await prisma.processedEvent.findMany({
      where: {
        processedAt: {
          gte: new Date(Date.now() - 60000), // Last minute
        },
      },
      orderBy: {
        processedAt: 'desc',
      },
    });
    console.log(`✅ Found ${recentEvents.length} recent event(s)`);

    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await prisma.processedEvent.delete({
      where: {
        id: testEvent.id,
      },
    });
    console.log('✅ Cleanup complete');

    console.log('\n🎉 All tests passed! ProcessedEvent model is working correctly.');
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

verifyProcessedEventModel();
