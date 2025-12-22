import xlsx from 'xlsx';

function parseWorkbook(path) {
  const workbook = xlsx.readFile(path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet);
}

function normalizeSku(value) {
  return value?.toString().trim().toLowerCase();
}

/**
 * Detect column names by pattern matching
 * Returns the best matching column name or null
 */
function detectColumn(columns, patterns) {
  if (!columns || columns.length === 0) return null;
  
  const normalizedColumns = columns.map(col => ({
    original: col,
    normalized: col?.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  }));
  
  for (const pattern of patterns) {
    const normalizedPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Exact match
    const exactMatch = normalizedColumns.find(col => 
      col.normalized === normalizedPattern
    );
    if (exactMatch) return exactMatch.original;
    
    // Contains match
    const containsMatch = normalizedColumns.find(col => 
      col.normalized.includes(normalizedPattern) || normalizedPattern.includes(col.normalized)
    );
    if (containsMatch) return containsMatch.original;
  }
  
  return null;
}

/**
 * Detect all relevant columns from data
 */
function detectColumns(data) {
  if (!data || data.length === 0) {
    return {
      skuColumn: null,
      costColumn: null,
      salesPriceColumn: null,
      marginColumn: null
    };
  }
  
  const columns = Object.keys(data[0]);
  
  // Detect SKU column
  const skuColumn = detectColumn(columns, [
    'sku', 'product name', 'product', 'item code', 'item id', 
    'product code', 'product id', 'item number', 'part number'
  ]);
  
  // Detect Cost column
  const costColumn = detectColumn(columns, [
    'cost price', 'cost', 'cost per item', 'unit cost', 
    'purchase price', 'buying price', 'wholesale price', 'price'
  ]);
  
  // Detect Sales Price column
  const salesPriceColumn = detectColumn(columns, [
    'sales price', 'sale price', 'selling price', 'retail price',
    'list price', 'sale', 'sales', 'price', 'selling'
  ]);
  
  // Detect Margin column
  const marginColumn = detectColumn(columns, [
    'margin', 'margin %', 'margin percentage', 'profit margin',
    'gross margin', 'margin percent', 'profit %', 'profit percentage'
  ]);
  
  return {
    skuColumn,
    costColumn,
    salesPriceColumn,
    marginColumn
  };
}

function toMap(data, detectedColumns) {
  const map = new Map();
  const { skuColumn } = detectedColumns;

  data.forEach(row => {
    const rawSku = skuColumn ? row[skuColumn] : null;
    const key = normalizeSku(rawSku);
    if (key) {
      map.set(key, row);
    }
  });

  return map;
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.\-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

function extractValue(row, columnName) {
  if (!columnName || !row) return null;
  return parseNumber(row[columnName]);
}

export function compareStocks(oldPath, newPath) {
  const oldData = parseWorkbook(oldPath);
  const newData = parseWorkbook(newPath);

  // Auto-detect columns from both files independently
  const oldColumns = detectColumns(oldData);
  const newColumns = detectColumns(newData);
  
  // For SKU mapping, try to use a common column or prefer new file's SKU column
  const skuColumn = newColumns.skuColumn || oldColumns.skuColumn;

  console.log('🔍 Detected columns - Old file:', oldColumns);
  console.log('🔍 Detected columns - New file:', newColumns);
  console.log('🔍 Using SKU column:', skuColumn);

  // Create maps using detected SKU column
  const oldMap = toMap(oldData, { skuColumn });
  const newMap = toMap(newData, { skuColumn });

  const added = [];
  const removed = [];
  const changed = [];

  newMap.forEach((newItem, normalizedSku) => {
    // Extract values using each file's own detected columns
    const newCost = extractValue(newItem, newColumns.costColumn);
    const newSalesPrice = extractValue(newItem, newColumns.salesPriceColumn);
    const newMargin = extractValue(newItem, newColumns.marginColumn);

    if (!oldMap.has(normalizedSku)) {
      added.push({ 
        sku: normalizedSku, 
        cost: newCost,
        salesPrice: newSalesPrice,
        margin: newMargin
      });
    } else {
      const oldItem = oldMap.get(normalizedSku);
      // Extract values using old file's detected columns
      const oldCost = extractValue(oldItem, oldColumns.costColumn);
      const oldSalesPrice = extractValue(oldItem, oldColumns.salesPriceColumn);
      const oldMargin = extractValue(oldItem, oldColumns.marginColumn);

      if (oldCost === null && newCost === null && (oldColumns.costColumn || newColumns.costColumn)) {
        console.warn(`Missing cost for SKU: ${normalizedSku}`, {
          oldCostColumn: oldColumns.costColumn,
          newCostColumn: newColumns.costColumn
        });
      }

      // Check if cost, sales price, or margin changed
      const costChanged = oldCost !== newCost;
      const salesPriceChanged = oldSalesPrice !== newSalesPrice;
      const marginChanged = oldMargin !== newMargin;

      if (costChanged || salesPriceChanged || marginChanged) {
        changed.push({
          sku: normalizedSku,
          oldCost,
          newCost,
          costChange: oldCost !== null && newCost !== null ? +(newCost - oldCost).toFixed(2) : null,
          costPercent: oldCost && newCost
            ? (((newCost - oldCost) / oldCost) * 100).toFixed(2)
            : null,
          oldSalesPrice,
          newSalesPrice,
          salesPriceChange: oldSalesPrice !== null && newSalesPrice !== null ? +(newSalesPrice - oldSalesPrice).toFixed(2) : null,
          salesPricePercent: oldSalesPrice && newSalesPrice
            ? (((newSalesPrice - oldSalesPrice) / oldSalesPrice) * 100).toFixed(2)
            : null,
          oldMargin,
          newMargin,
          marginChange: oldMargin !== null && newMargin !== null ? +(newMargin - oldMargin).toFixed(2) : null
        });
      }
    }
  });

  oldMap.forEach((_, normalizedSku) => {
    if (!newMap.has(normalizedSku)) {
      removed.push(normalizedSku);
    }
  });

  return {
    summary: {
      oldCount: oldData.length,
      newCount: newData.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length
    },
    added,
    removed,
    changed,
    detectedColumns: {
      old: oldColumns,
      new: newColumns
    } // Include detected columns in response for debugging
  };
}

