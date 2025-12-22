# Price Comparison Test Files

This folder contains test Excel files for testing the price comparison agent functionality.

## Files

- **old_stock_prices.xlsx** - Previous/old stock file with 10 products
- **new_stock_prices.xlsx** - Current/new stock file with 12 products

## File Structure

Both files contain the following columns:
- **Product Name(required)** / **sku** - Product identifier
- **SKU** - Stock keeping unit
- **Cost Price** - Cost per item
- **Sales Price** - Selling price
- **Margin** - Margin percentage (calculated as: (Sales Price - Cost Price) / Sales Price × 100)
- **Description** - Product description
- **Category** - Product category

## Test Data Summary

### Old Stock File (10 products)
Contains the following products with Cost Price, Sales Price, and Margin:

| SKU | Product | Cost Price | Sales Price | Margin |
|-----|---------|------------|-------------|--------|
| AC-001 | AC-Unit-Basic | $1,500.00 | $2,250.00 | 33.33% |
| AC-002 | AC-Unit-Premium | $2,500.00 | $3,750.00 | 33.33% |
| HT-001 | Heater-Standard | $800.00 | $1,200.00 | 33.33% |
| TS-001 | Thermostat-Smart | $300.00 | $450.00 | 33.33% |
| FL-001 | Filter-Standard | $25.00 | $40.00 | 37.50% |
| DW-001 | Duct-Work-Basic | $450.00 | $675.00 | 33.33% *(removed)* |
| VF-001 | Ventilation-Fan | $200.00 | $300.00 | 33.33% |
| CP-001 | Compressor-Standard | $1,200.00 | $1,800.00 | 33.33% |
| RF-001 | Refrigerant-R410A | $150.00 | $225.00 | 33.33% |
| IN-001 | Insulation-Tube | $35.00 | $55.00 | 36.36% |

### New Stock File (12 products)
Contains updated prices and new products:

#### Changed Products (9 products):

| SKU | Cost Price Change | Sales Price Change | Margin Change |
|-----|-------------------|-------------------|---------------|
| AC-001 | $1,500 → $1,650 (+10%) | $2,250 → $2,400 (+6.67%) | 33.33% → 31.25% (-2.08%) |
| AC-002 | $2,500 → $2,300 (-8%) | $3,750 → $3,600 (-4%) | 33.33% → 36.11% (+2.78%) |
| HT-001 | $800 → $850 (+6.25%) | $1,200 → $1,300 (+8.33%) | 33.33% → 34.62% (+1.29%) |
| TS-001 | $300 → $320 (+6.67%) | $450 → $480 (+6.67%) | 33.33% → 33.33% (unchanged) |
| FL-001 | $25 → $28 (+12%) | $40 → $45 (+12.5%) | 37.50% → 37.78% (+0.28%) |
| VF-001 | $200 → $180 (-10%) | $300 → $280 (-6.67%) | 33.33% → 35.71% (+2.38%) |
| CP-001 | $1,200 → $1,320 (+10%) | $1,800 → $1,950 (+8.33%) | 33.33% → 32.31% (-1.02%) |
| RF-001 | $150 → $165 (+10%) | $225 → $240 (+6.67%) | 33.33% → 31.25% (-2.08%) |
| IN-001 | $35 → $40 (+14.29%) | $55 → $62 (+12.73%) | 36.36% → 35.48% (-0.88%) |

#### Added Products (3 products):
- **AC-003**: AC-Unit-Deluxe - Cost: $3,500, Sales: $5,250, Margin: 33.33%
- **HT-002**: Heater-Premium - Cost: $1,200, Sales: $1,800, Margin: 33.33%
- **FL-002**: Filter-Premium - Cost: $55, Sales: $85, Margin: 35.29%

#### Removed Products (1 product):
- **DW-001**: Duct-Work-Basic - Cost: $450, Sales: $675, Margin: 33.33%

## Expected Comparison Results

When comparing these files, you should see:
- **Summary:**
  - Old Count: 10
  - New Count: 12
  - Added: 3
  - Removed: 1
  - Changed: 9

- **Price Changes:**
  - Cost Price: 9 products changed (6 increases, 2 decreases, 1 unchanged)
  - Sales Price: 9 products changed (7 increases, 2 decreases)
  - Margin: 8 products changed (4 increases, 4 decreases, 1 unchanged)

## How to Use for Testing

1. Start the Worxstream Agent server
2. Open the frontend application
3. In the chat input area, select "Price Compare" from the tool dropdown
4. Upload `old_stock_prices.xlsx` as the "Old Price File"
5. Upload `new_stock_prices.xlsx` as the "New Price File"
6. Optionally add a question like:
   - "What are the biggest price increases?"
   - "Which products were added?"
   - "Show me a summary of changes"
   - "What's the total cost impact of these changes?"
7. Click send to see the comparison results and AI analysis

## Regenerating Test Files

To regenerate the test files with fresh data, run:

```bash
node test/generateTestFiles.js
```

This will recreate both Excel files in the test folder.

## File Format

The files use the expected column formats:
- **Old file:** Uses `Product Name(required)`, `SKU`, `Cost Per Item`
- **New file:** Uses `sku`, `Product Name(required)`, `cost`

Both formats are supported by the comparison utility to test column name flexibility.

