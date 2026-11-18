#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/lib/blockchain/activity-listener.ts');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// Replace all occurrences of event.launchpadAddress in console.warn messages
content = content.replace(
  /console\.warn\(`⚠️ Launchpad not found in database: \$\{event\.launchpadAddress\}/g,
  'console.warn(`⚠️ Launchpad not found in database: ${normalizedLaunchpadAddress}'
);

// Write back
fs.writeFileSync(filePath, content, 'utf8');

console.log('✅ Fixed all remaining event.launchpadAddress references in console.warn messages');
