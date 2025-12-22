/**
 * Price Comparison Tools - MCP Tool Definitions
 */

import { z } from 'zod';
import { registerTool } from '../server.js';

export function registerPriceComparisonTools() {
  registerTool(
    'compare_stock_prices',
    {
      title: 'Compare Stock Prices',
      description: 'Compare two Excel files containing stock/price data to identify changes, additions, and removals. Returns detailed comparison results including cost changes and percentage differences. Use this tool when you have comparison data from file uploads.',
      inputSchema: {
        comparisonData: z.object({
          summary: z.object({
            oldCount: z.number(),
            newCount: z.number(),
            added: z.number(),
            removed: z.number(),
            changed: z.number(),
          }),
          changed: z.array(z.any()),
          added: z.array(z.any()),
          removed: z.array(z.any()),
        }).describe('Comparison data from uploaded files'),
      },
    },
    async ({ comparisonData }) => {
      try {
        // Return the comparison data for Claude to analyze
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              success: true,
              data: comparisonData,
              message: 'Price comparison completed successfully'
            }, null, 2) 
          }],
        };
      } catch (error) {
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({ 
              success: false, 
              error: error.message || 'Failed to process price comparison' 
            }, null, 2) 
          }],
        };
      }
    }
  );
}

