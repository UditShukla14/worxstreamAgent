/**
 * Report Helper Functions - Examples and utilities for the Reports Agent
 */

import { 
  ChartGenerator, 
  ReportAnalytics, 
  formatCurrency, 
  formatPercentage, 
  generateExecutiveSummary,
  generateMandatoryDashboard,
  validateMandatoryCharts 
} from './chartGenerator.js';

/**
 * Example: Process and format estimate report data
 * @param {Object} reportData - Raw report data from API
 * @param {string} userQuery - Original user query for context
 * @returns {string} Formatted report with charts and insights
 */
export function processEstimateReport(reportData, userQuery) {
  const { data, meta } = reportData;
  
  // Generate analytics
  const analytics = ReportAnalytics.analyzeSalesPerformance(data.data);
  
  // Create KPI cards
  const kpis = [
    {
      label: "Total Estimates",
      value: data.data.length.toString(),
      icon: "dollar",
      color: "blue"
    },
    {
      label: "Total Value",
      value: formatCurrency(meta.totals.grandTotal),
      icon: "chart",
      color: "green"
    },
    {
      label: "Average Value",
      value: formatCurrency(analytics.summary.avgSales),
      icon: "package",
      color: "purple"
    },
    {
      label: "Gross Profit",
      value: formatCurrency(meta.totals.grossProfit),
      icon: "check",
      color: "cyan"
    }
  ];

  // Create monthly trends chart if applicable
  const monthlyData = Object.entries(analytics.monthlyTrends);
  let trendChart = '';
  if (monthlyData.length > 0) {
    const periods = monthlyData.map(([month]) => month);
    const values = monthlyData.map(([, data]) => data.total);
    
    trendChart = ChartGenerator.generateLineChart({
      title: "Estimates Trend by Month",
      periods,
      values,
      valueLabel: "Total ($)",
      color: "green"
    });
  }

  // Create status breakdown chart
  const statusSegments = Object.entries(analytics.statusBreakdown).map(([status, amount]) => ({
    label: status,
    value: amount,
    percentage: Math.round((amount / meta.totals.grandTotal) * 100)
  }));

  const statusChart = ChartGenerator.generatePieChart({
    title: "Estimates by Status",
    segments: statusSegments,
    valueLabel: "Amount ($)"
  });

  // Generate executive summary
  const summary = generateExecutiveSummary(reportData, analytics);

  // Build the complete response with MANDATORY visual elements
  let response = `Found ${data.data.length} estimates for the specified period.\n\n`;
  response += `**${summary}**\n\n`;
  
  // MANDATORY: KPI Cards
  response += ChartGenerator.generateKPICards(kpis) + '\n\n';
  
  // MANDATORY: At least one chart
  if (trendChart) {
    response += trendChart + '\n\n';
  }
  
  // MANDATORY: Status chart (always include)
  response += statusChart + '\n\n';

  // MANDATORY: Detailed table for the estimates
  response += formatEstimatesTable(data.data);

  // Validate that all mandatory elements are present
  const validation = validateMandatoryCharts(response);
  if (!validation.isValid) {
    console.warn('Report missing mandatory visual elements:', validation.missing);
    // Add fallback chart if missing
    if (!response.includes('<chart>')) {
      response += '\n\n' + ChartGenerator.generateBarChart({
        title: 'Estimates Overview',
        categories: ['Total Count'],
        values: [data.data.length],
        valueLabel: 'Count',
        color: 'blue'
      });
    }
  }

  return response;
}

/**
 * Example: Process and format goal performance report
 * @param {Object} goalData - Goal data
 * @param {Object} performanceData - Performance metrics
 * @returns {string} Formatted goal report with gauges and trends
 */
export function processGoalReport(goalData, performanceData) {
  const analytics = ReportAnalytics.analyzeGoalProgress({
    targetSales: goalData.salesGoalAmount,
    actualSales: performanceData.totalSales || 0,
    targetCustomers: goalData.customerGoalCount,
    actualCustomers: performanceData.totalCustomers || 0
  });

  // Generate performance gauges
  const salesGauge = ChartGenerator.generatePerformanceGauge({
    title: "Sales Goal Progress",
    current: performanceData.totalSales || 0,
    target: goalData.salesGoalAmount,
    unit: ""
  });

  const customerGauge = ChartGenerator.generatePerformanceGauge({
    title: "Customer Acquisition Goal",
    current: performanceData.totalCustomers || 0,
    target: goalData.customerGoalCount,
    unit: " customers"
  });

  // Generate trend if monthly data available
  let monthlyChart = '';
  if (performanceData.monthly) {
    const months = Object.keys(performanceData.monthly).sort();
    const salesValues = months.map(month => performanceData.monthly[month].sales || 0);
    
    monthlyChart = ChartGenerator.generateLineChart({
      title: "Monthly Sales Progress",
      periods: months,
      values: salesValues,
      valueLabel: "Sales ($)",
      color: "blue"
    });
  }

  // Build response
  let response = `Goal Performance Report: ${goalData.name}\n\n`;
  response += `**Overall Achievement: ${analytics.overallScore}% (${analytics.isOnTrack ? 'On Track' : 'Needs Attention'})**\n\n`;
  response += salesGauge + '\n\n';
  response += customerGauge + '\n\n';
  
  if (monthlyChart) {
    response += monthlyChart + '\n\n';
  }

  return response;
}

/**
 * Format estimates data into a table
 * @param {Array} estimates - Array of estimate records
 * @returns {string} Table XML
 */
function formatEstimatesTable(estimates) {
  const limitedEstimates = estimates.slice(0, 10); // Limit for readability
  
  let table = '<table title="Recent Estimates">\n<headers>\n';
  table += '<th>Number</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th>\n';
  table += '</headers>\n';

  limitedEstimates.forEach(estimate => {
    const statusColor = getStatusColor(estimate.statusDetails?.statusCode);
    table += '<row>\n';
    table += `<td>${estimate.customNumber}</td>`;
    table += `<td>${estimate.customerName}</td>`;
    table += `<td>${formatDate(estimate.issueDate)}</td>`;
    table += `<td>${formatCurrency(estimate.grandTotal)}</td>`;
    table += `<td status="${statusColor}">${estimate.statusDetails?.statusName || 'Unknown'}</td>`;
    table += '\n</row>\n';
  });

  table += '</table>';

  if (estimates.length > 10) {
    table += `\n\n*Showing 10 of ${estimates.length} estimates*`;
  }

  return table;
}

/**
 * Get status color based on status code
 * @param {string} statusCode - Status code
 * @returns {string} Color name
 */
function getStatusColor(statusCode) {
  if (!statusCode) return 'warning';
  
  const successStatuses = ['approved', 'accepted', 'completed', 'paid'];
  const errorStatuses = ['rejected', 'cancelled', 'declined'];
  
  const lowerStatus = statusCode.toLowerCase();
  
  if (successStatuses.some(s => lowerStatus.includes(s))) return 'success';
  if (errorStatuses.some(s => lowerStatus.includes(s))) return 'error';
  
  return 'warning';
}

/**
 * Format date for display
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @returns {string} Formatted date
 */
function formatDate(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Generate insights text based on data analysis
 * @param {Object} analytics - Analytics results
 * @param {string} reportType - Type of report (estimates, invoices, goals)
 * @returns {string} Insights text
 */
export function generateInsights(analytics, reportType) {
  const insights = [];

  if (reportType === 'estimates' || reportType === 'invoices') {
    // Revenue insights
    if (analytics.summary.avgSales > 10000) {
      insights.push("High-value transactions indicate strong client relationships");
    }
    
    // Status insights
    const statusKeys = Object.keys(analytics.statusBreakdown);
    const paidPercentage = (analytics.statusBreakdown['Paid'] || 0) / analytics.summary.totalSales;
    
    if (paidPercentage > 0.8) {
      insights.push("Excellent collection rate with over 80% paid invoices");
    } else if (paidPercentage < 0.5) {
      insights.push("Collection needs attention - consider follow-up on outstanding invoices");
    }

    // Trend insights
    const monthlyEntries = Object.entries(analytics.monthlyTrends);
    if (monthlyEntries.length >= 2) {
      const lastTwo = monthlyEntries.slice(-2);
      const growth = ((lastTwo[1][1].total - lastTwo[0][1].total) / lastTwo[0][1].total) * 100;
      
      if (growth > 10) {
        insights.push(`Strong growth trend with ${growth.toFixed(1)}% increase month-over-month`);
      } else if (growth < -10) {
        insights.push(`Declining trend with ${Math.abs(growth).toFixed(1)}% decrease - investigate market conditions`);
      }
    }
  }

  if (reportType === 'goals') {
    if (analytics.salesAchievement >= 100) {
      insights.push("Sales goal exceeded - consider increasing targets for next period");
    } else if (analytics.salesAchievement < 50) {
      insights.push("Sales significantly below target - review strategy and execution");
    }

    if (analytics.customerAchievement >= 100) {
      insights.push("Customer acquisition goal met - focus on retention and upselling");
    }
  }

  return insights.length > 0 ? '\n**Key Insights:**\n' + insights.map(i => `• ${i}`).join('\n') : '';
}

/**
 * Generate actionable recommendations
 * @param {Object} analytics - Analytics results
 * @param {string} reportType - Type of report
 * @returns {string} Recommendations text
 */
export function generateRecommendations(analytics, reportType) {
  const recommendations = [];

  if (reportType === 'estimates') {
    const conversionRate = 0.7; // Placeholder - would come from data
    if (conversionRate < 0.5) {
      recommendations.push("Review estimate approval process and pricing strategy");
    }
    
    recommendations.push("Follow up on pending estimates within 48 hours");
    recommendations.push("Analyze successful estimates to replicate winning patterns");
  }

  if (reportType === 'invoices') {
    const avgPaymentDays = 30; // Placeholder
    if (avgPaymentDays > 30) {
      recommendations.push("Implement early payment discounts to improve cash flow");
    }
    
    recommendations.push("Set up automated payment reminders for overdue invoices");
  }

  if (reportType === 'goals') {
    if (analytics.salesAchievement < 75) {
      recommendations.push("Increase sales activities and lead generation efforts");
      recommendations.push("Review pricing strategy and competitive positioning");
    }
    
    if (analytics.customerAchievement < 75) {
      recommendations.push("Enhance marketing campaigns and referral programs");
    }
  }

  return recommendations.length > 0 ? '\n**Recommendations:**\n' + recommendations.map(r => `• ${r}`).join('\n') : '';
}