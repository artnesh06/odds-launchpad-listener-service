/**
 * Test Metadata Fetching
 * 
 * Script to test fetching metadata from token URI
 */

async function testMetadataFetch() {
  const baseURI = 'https://nft-launchpad-odds-fe.vercel.app/api/metadata/0x7F2514313C46e5EF82c22477151C63cB93Fc4dD6/';
  const tokenId = '63';
  
  // Try different URI formats
  const uris = [
    `${baseURI}${tokenId}`,
    `${baseURI.replace(/\/$/, '')}/${tokenId}`,
    `${baseURI}${tokenId}.json`,
  ];

  for (const tokenUri of uris) {
    console.log(`\n🔍 Testing: ${tokenUri}`);

    try {
      const response = await fetch(tokenUri, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'NFT-Listener-Service/1.0'
        }
      });

      console.log(`📊 Response status: ${response.status}`);

      if (response.ok) {
        const metadata = await response.json();
        console.log(`✅ Metadata fetched successfully:`);
        console.log(JSON.stringify(metadata, null, 2));
        return; // Success, exit
      } else {
        console.log(`❌ Failed: ${response.statusText}`);
      }
    } catch (error: any) {
      console.log(`❌ Error:`, error.message);
    }
  }
  
  console.log(`\n❌ All URI formats failed`);
}

testMetadataFetch();
