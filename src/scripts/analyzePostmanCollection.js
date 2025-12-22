/**
 * Analyze Postman Collection and Identify Missing APIs
 * Run with: node src/scripts/analyzePostmanCollection.js
 */

import {
  parsePostmanCollection,
  groupApisByCategory,
  extractEndpointsFromTools,
  findMissingApis,
  generateToolName,
} from '../utils/postmanParser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POSTMAN_COLLECTION_PATH = path.join(
  __dirname,
  '../../Worxstream Backend APIs.postman_collection.json'
);

console.log('📋 Analyzing Postman Collection...\n');

try {
  // Parse Postman collection
  console.log('1. Parsing Postman collection...');
  const collection = parsePostmanCollection(POSTMAN_COLLECTION_PATH);
  console.log(`   ✓ Found ${collection.totalApis} APIs in "${collection.collectionName}"\n`);

  // Extract existing endpoints
  console.log('2. Extracting existing tool endpoints...');
  const existingEndpoints = extractEndpointsFromTools();
  console.log(`   ✓ Found ${existingEndpoints.length} existing endpoints\n`);

  // Find missing APIs
  console.log('3. Comparing and finding missing APIs...');
  const missingApis = findMissingApis(collection.apis, existingEndpoints);
  console.log(`   ✓ Found ${missingApis.length} missing APIs\n`);

  // Group missing APIs by category
  const grouped = groupApisByCategory(missingApis);

  // Generate report
  console.log('='.repeat(80));
  console.log('MISSING APIs REPORT');
  console.log('='.repeat(80));
  console.log(`\nTotal Missing: ${missingApis.length}`);
  console.log(`Total Existing: ${existingEndpoints.length}`);
  console.log(`Total in Collection: ${collection.totalApis}\n`);

  console.log('\nMissing APIs by Category:');
  console.log('-'.repeat(80));

  const categoryStats = [];
  for (const [category, apis] of Object.entries(grouped)) {
    categoryStats.push({ category, count: apis.length });
    console.log(`\n${category}: ${apis.length} APIs`);
    console.log('  ' + '-'.repeat(78));
    
    // Show first 10 APIs per category
    apis.slice(0, 10).forEach(api => {
      const toolName = generateToolName(api.name, api.method, api.endpoint);
      console.log(`  [${api.method.padEnd(6)}] ${api.endpoint.padEnd(50)} → ${toolName}`);
    });
    
    if (apis.length > 10) {
      console.log(`  ... and ${apis.length - 10} more`);
    }
  }

  // Summary by HTTP method
  console.log('\n\nMissing APIs by HTTP Method:');
  console.log('-'.repeat(80));
  const methodCounts = {};
  missingApis.forEach(api => {
    methodCounts[api.method] = (methodCounts[api.method] || 0) + 1;
  });
  Object.entries(methodCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([method, count]) => {
      console.log(`  ${method.padEnd(6)}: ${count}`);
    });

  // Save detailed report to file
  const reportPath = path.join(__dirname, '../../postman-analysis-report.json');
  const report = {
    collectionName: collection.collectionName,
    totalApis: collection.totalApis,
    existingEndpoints: existingEndpoints.length,
    missingApis: missingApis.length,
    categories: categoryStats,
    missingApisByCategory: grouped,
    missingApis: missingApis.map(api => ({
      name: api.name,
      method: api.method,
      endpoint: api.endpoint,
      folderPath: api.folderPath,
      toolName: generateToolName(api.name, api.method, api.endpoint),
      body: api.body,
      queryParams: api.queryParams,
    })),
  };

  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n\n📄 Detailed report saved to: ${reportPath}`);

  console.log('\n' + '='.repeat(80));
  console.log('Analysis complete!');
  console.log('='.repeat(80));

} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

