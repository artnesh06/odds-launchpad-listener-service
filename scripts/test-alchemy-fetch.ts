/**
 * Test Alchemy API Fetch
 * 
 * Script to test fetching metadata from Alchemy API
 */

import axios from 'axios';

async function testAlchemyFetch() {
  const apiKey = 'YOUR_ALCHEMY_KEY';
  const network = 'eth-sepolia';
  const contractAddress = '0x7f2514313c46e5ef82c22477151c63cb93fc4dd6';
  const tokenId = '63';

  const url = `https://${network}.g.alchemy.com/nft/v3/${apiKey}/getNFTMetadata`;

  console.log(`🔍 Testing Alchemy API for token ${tokenId}`);
  console.log(`📍 URL: ${url}`);
  console.log(`📦 Contract: ${contractAddress}`);

  try {
    const response = await axios.get(url, {
      params: {
        contractAddress,
        tokenId,
        refreshCache: false
      }
    });

    console.log(`✅ Alchemy API response:`);
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    if (error.response) {
      console.error(`❌ Alchemy API error: ${error.response.status}`);
      console.error(`Response:`, error.response.data);
    } else {
      console.error(`❌ Error:`, error.message);
    }
  }
}

testAlchemyFetch();
