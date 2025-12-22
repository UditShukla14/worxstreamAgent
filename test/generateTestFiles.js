import xlsx from 'xlsx';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to calculate margin percentage
function calculateMargin(costPrice, salesPrice) {
  if (!salesPrice || salesPrice === 0) return 0;
  return ((salesPrice - costPrice) / salesPrice * 100).toFixed(2);
}

// Old/Previous Stock File Data
// Format: Cost Price, Sales Price, Margin (calculated)
const oldStockData = [
  {
    'Product Name(required)': 'AC-Unit-Basic',
    'SKU': 'AC-001',
    'Cost Price': 1500.00,
    'Sales Price': 2250.00,
    'Margin': calculateMargin(1500.00, 2250.00),
    'Description': 'Basic Air Conditioning Unit',
    'Category': 'HVAC'
  },
  {
    'Product Name(required)': 'AC-Unit-Premium',
    'SKU': 'AC-002',
    'Cost Price': 2500.00,
    'Sales Price': 3750.00,
    'Margin': calculateMargin(2500.00, 3750.00),
    'Description': 'Premium Air Conditioning Unit',
    'Category': 'HVAC'
  },
  {
    'Product Name(required)': 'Heater-Standard',
    'SKU': 'HT-001',
    'Cost Price': 800.00,
    'Sales Price': 1200.00,
    'Margin': calculateMargin(800.00, 1200.00),
    'Description': 'Standard Heater',
    'Category': 'HVAC'
  },
  {
    'Product Name(required)': 'Thermostat-Smart',
    'SKU': 'TS-001',
    'Cost Price': 300.00,
    'Sales Price': 450.00,
    'Margin': calculateMargin(300.00, 450.00),
    'Description': 'Smart Thermostat',
    'Category': 'Controls'
  },
  {
    'Product Name(required)': 'Filter-Standard',
    'SKU': 'FL-001',
    'Cost Price': 25.00,
    'Sales Price': 40.00,
    'Margin': calculateMargin(25.00, 40.00),
    'Description': 'Standard Air Filter',
    'Category': 'Accessories'
  },
  {
    'Product Name(required)': 'Duct-Work-Basic',
    'SKU': 'DW-001',
    'Cost Price': 450.00,
    'Sales Price': 675.00,
    'Margin': calculateMargin(450.00, 675.00),
    'Description': 'Basic Duct Work',
    'Category': 'Installation'
  },
  {
    'Product Name(required)': 'Ventilation-Fan',
    'SKU': 'VF-001',
    'Cost Price': 200.00,
    'Sales Price': 300.00,
    'Margin': calculateMargin(200.00, 300.00),
    'Description': 'Ventilation Fan',
    'Category': 'Ventilation'
  },
  {
    'Product Name(required)': 'Compressor-Standard',
    'SKU': 'CP-001',
    'Cost Price': 1200.00,
    'Sales Price': 1800.00,
    'Margin': calculateMargin(1200.00, 1800.00),
    'Description': 'Standard Compressor',
    'Category': 'Components'
  },
  {
    'Product Name(required)': 'Refrigerant-R410A',
    'SKU': 'RF-001',
    'Cost Price': 150.00,
    'Sales Price': 225.00,
    'Margin': calculateMargin(150.00, 225.00),
    'Description': 'R410A Refrigerant',
    'Category': 'Refrigerants'
  },
  {
    'Product Name(required)': 'Insulation-Tube',
    'SKU': 'IN-001',
    'Cost Price': 35.00,
    'Sales Price': 55.00,
    'Margin': calculateMargin(35.00, 55.00),
    'Description': 'Tube Insulation',
    'Category': 'Accessories'
  }
];

// New/Current Stock File Data
// Changes in Cost Price, Sales Price, and Margin:
// - AC-001: Cost 1500→1650 (+10%), Sales 2250→2400 (+6.67%), Margin 33.33%→31.25% (decreased)
// - AC-002: Cost 2500→2300 (-8%), Sales 3750→3600 (-4%), Margin 33.33%→36.11% (increased)
// - HT-001: Cost 800→850 (+6.25%), Sales 1200→1300 (+8.33%), Margin 33.33%→34.62% (increased)
// - TS-001: Cost 300→320 (+6.67%), Sales 450→480 (+6.67%), Margin 33.33%→33.33% (same)
// - FL-001: Cost 25→28 (+12%), Sales 40→45 (+12.5%), Margin 37.5%→37.78% (slight increase)
// - VF-001: Cost 200→180 (-10%), Sales 300→280 (-6.67%), Margin 33.33%→35.71% (increased)
// - CP-001: Cost 1200→1320 (+10%), Sales 1800→1950 (+8.33%), Margin 33.33%→32.31% (decreased)
// - RF-001: Cost 150→165 (+10%), Sales 225→240 (+6.67%), Margin 33.33%→31.25% (decreased)
// - IN-001: Cost 35→40 (+14.29%), Sales 55→62 (+12.73%), Margin 36.36%→35.48% (decreased)
// - DW-001: Removed (not in new file)
// - Added: AC-003 (AC-Unit-Deluxe) - Cost 3500, Sales 5250, Margin 33.33%
// - Added: HT-002 (Heater-Premium) - Cost 1200, Sales 1800, Margin 33.33%
// - Added: FL-002 (Filter-Premium) - Cost 55, Sales 85, Margin 35.29%
const newStockData = [
  {
    'sku': 'AC-001',
    'Product Name(required)': 'AC-Unit-Basic',
    'Cost Price': 1650.00,
    'Sales Price': 2400.00,
    'Margin': calculateMargin(1650.00, 2400.00),
    'Description': 'Basic Air Conditioning Unit',
    'Category': 'HVAC'
  },
  {
    'sku': 'AC-002',
    'Product Name(required)': 'AC-Unit-Premium',
    'Cost Price': 2300.00,
    'Sales Price': 3600.00,
    'Margin': calculateMargin(2300.00, 3600.00),
    'Description': 'Premium Air Conditioning Unit',
    'Category': 'HVAC'
  },
  {
    'sku': 'HT-001',
    'Product Name(required)': 'Heater-Standard',
    'Cost Price': 850.00,
    'Sales Price': 1300.00,
    'Margin': calculateMargin(850.00, 1300.00),
    'Description': 'Standard Heater',
    'Category': 'HVAC'
  },
  {
    'sku': 'TS-001',
    'Product Name(required)': 'Thermostat-Smart',
    'Cost Price': 320.00,
    'Sales Price': 480.00,
    'Margin': calculateMargin(320.00, 480.00),
    'Description': 'Smart Thermostat',
    'Category': 'Controls'
  },
  {
    'sku': 'FL-001',
    'Product Name(required)': 'Filter-Standard',
    'Cost Price': 28.00,
    'Sales Price': 45.00,
    'Margin': calculateMargin(28.00, 45.00),
    'Description': 'Standard Air Filter',
    'Category': 'Accessories'
  },
  {
    'sku': 'VF-001',
    'Product Name(required)': 'Ventilation-Fan',
    'Cost Price': 180.00,
    'Sales Price': 280.00,
    'Margin': calculateMargin(180.00, 280.00),
    'Description': 'Ventilation Fan',
    'Category': 'Ventilation'
  },
  {
    'sku': 'CP-001',
    'Product Name(required)': 'Compressor-Standard',
    'Cost Price': 1320.00,
    'Sales Price': 1950.00,
    'Margin': calculateMargin(1320.00, 1950.00),
    'Description': 'Standard Compressor',
    'Category': 'Components'
  },
  {
    'sku': 'RF-001',
    'Product Name(required)': 'Refrigerant-R410A',
    'Cost Price': 165.00,
    'Sales Price': 240.00,
    'Margin': calculateMargin(165.00, 240.00),
    'Description': 'R410A Refrigerant',
    'Category': 'Refrigerants'
  },
  {
    'sku': 'IN-001',
    'Product Name(required)': 'Insulation-Tube',
    'Cost Price': 40.00,
    'Sales Price': 62.00,
    'Margin': calculateMargin(40.00, 62.00),
    'Description': 'Tube Insulation',
    'Category': 'Accessories'
  },
  {
    'sku': 'AC-003',
    'Product Name(required)': 'AC-Unit-Deluxe',
    'Cost Price': 3500.00,
    'Sales Price': 5250.00,
    'Margin': calculateMargin(3500.00, 5250.00),
    'Description': 'Deluxe Air Conditioning Unit',
    'Category': 'HVAC'
  },
  {
    'sku': 'HT-002',
    'Product Name(required)': 'Heater-Premium',
    'Cost Price': 1200.00,
    'Sales Price': 1800.00,
    'Margin': calculateMargin(1200.00, 1800.00),
    'Description': 'Premium Heater',
    'Category': 'HVAC'
  },
  {
    'sku': 'FL-002',
    'Product Name(required)': 'Filter-Premium',
    'Cost Price': 55.00,
    'Sales Price': 85.00,
    'Margin': calculateMargin(55.00, 85.00),
    'Description': 'Premium Air Filter',
    'Category': 'Accessories'
  }
];

// Create workbook for old stock file
const oldWorkbook = xlsx.utils.book_new();
const oldWorksheet = xlsx.utils.json_to_sheet(oldStockData);
xlsx.utils.book_append_sheet(oldWorkbook, oldWorksheet, 'Stock');

// Create workbook for new stock file
const newWorkbook = xlsx.utils.book_new();
const newWorksheet = xlsx.utils.json_to_sheet(newStockData);
xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'Stock');

// Write files
const oldFilePath = join(__dirname, 'old_stock_prices.xlsx');
const newFilePath = join(__dirname, 'new_stock_prices.xlsx');

xlsx.writeFile(oldWorkbook, oldFilePath);
xlsx.writeFile(newWorkbook, newFilePath);

console.log('✅ Test files generated successfully!');
console.log(`📁 Old stock file: ${oldFilePath}`);
console.log(`📁 New stock file: ${newFilePath}`);
console.log('\n📊 Summary of changes:');
console.log('  - Old file: 10 products');
console.log('  - New file: 12 products');
console.log('  - Changed Cost Prices: 9 products');
console.log('  - Changed Sales Prices: 9 products');
console.log('  - Changed Margins: 8 products (1 unchanged)');
console.log('  - Added products: 3 (AC-003, HT-002, FL-002)');
console.log('  - Removed products: 1 (DW-001)');
console.log('\n📈 Key Changes:');
console.log('  - Cost Price changes: +6.25% to +14.29% (increases), -8% to -10% (decreases)');
console.log('  - Sales Price changes: +6.67% to +12.73% (increases), -4% to -6.67% (decreases)');
console.log('  - Margin changes: -2.08% to +2.38% (varies by product)');
console.log('\n💡 Use these files to test the price comparison feature!');

