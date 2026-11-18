#!/usr/bin/env node

/**
 * Script to add address normalization to all event handlers
 * that use event.launchpadAddress
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/lib/blockchain/activity-listener.ts');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// List of event handlers that need fixing
const eventHandlers = [
  'handlePhaseAddedEvent',
  'handleRevealedEvent',
  'handleTreasuryUpdatedEvent',
  'handleWithdrawnEvent',
  'handleOwnershipTransferredEvent',
  'handlePlatformFeeToggledEvent',
  'handlePlatformFlatFeeUpdatedEvent',
  'handleRoyaltyUpdatedEvent',
  'handlePhaseUpdatedEvent',
  'handleCollectionCreatedEvent'
];

let modified = false;

for (const handler of eventHandlers) {
  // Pattern to find the handler function and add normalization after validateEventData
  const pattern = new RegExp(
    `(private async ${handler}\\(event: \\w+\\): Promise<void> \\{\\s*try \\{\\s*(?:\/\/ [^\\n]*\\n\\s*)?this\\.validateEventData\\([^)]+\\);)`,
    'g'
  );
  
  const replacement = `$1\n\n      // Normalize launchpad address to lowercase\n      const normalizedLaunchpadAddress = event.launchpadAddress.toLowerCase();`;
  
  if (pattern.test(content)) {
    content = content.replace(pattern, replacement);
    console.log(`✅ Added normalization to ${handler}`);
    modified = true;
  } else {
    console.log(`⚠️  Could not find pattern for ${handler}`);
  }
}

// Replace all event.launchpadAddress with normalizedLaunchpadAddress in these handlers
// This is more complex and might need manual review
if (modified) {
  console.log('\n⚠️  Manual step required:');
  console.log('Replace event.launchpadAddress with normalizedLaunchpadAddress in:');
  console.log('- isDuplicateActivity() calls');
  console.log('- prisma.launchpad.findUnique() where clauses');
  console.log('- console.log() and console.warn() messages');
  
  // Write the modified content back
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('\n✅ File updated successfully!');
  console.log('⚠️  Please review the changes and complete manual replacements.');
} else {
  console.log('\n❌ No modifications made. Patterns might have changed.');
}
