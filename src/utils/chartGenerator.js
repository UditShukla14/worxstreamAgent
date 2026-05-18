/**
 * Chart Generator Utility - Generates visual charts and infographics for reports
 */

/**
 * Generate chart XML for different types of data visualization
 */
export class ChartGenerator {
  
  /**
   * Generate a bar chart for comparing values across categories
   * @param {Object} data - Chart data
   * @param {string} data.title - Chart title
   * @param {Array} data.categories - Array of category names
   * @param {Array} data.values - Array of values corresponding to categories
   * @param {string} data.valueLabel - Label for the values (e.g., "Sales ($)", "Count")
   * @param {string} data.color - Chart color theme (blue, green, purple, yellow, red, cyan)
   * @returns {string} Chart XML
   */
  static generateBarChart({ title, categories, values, valueLabel = "Value", color = "blue" }) {
    const maxValue = Math.max(...values);
    const chartData = categories.map((category, index) => ({
      category,
      value: values[index],
      percentage: Math.round((values[index] / maxValue) * 100)
    }));

    return `<chart type="bar" title="${title}" color="${color}">
<chart-data label="${valueLabel}">
${chartData.map(item => `<bar category="${item.category}" value="${item.value}" percentage="${item.percentage}"/>`).join('\n')}
</chart-data>
</chart>`;
  }

  /**
   * Generate a line chart for trending data over time
   * @param {Object} data - Chart data
   * @param {string} data.title - Chart title
   * @param {Array} data.periods - Array of time periods (e.g., months, quarters)
   * @param {Array} data.values - Array of values corresponding to periods
   * @param {string} data.valueLabel - Label for the values
   * @param {string} data.color - Chart color theme
   * @returns {string} Chart XML
   */
  static generateLineChart({ title, periods, values, valueLabel = "Value", color = "green" }) {
    const chartData = periods.map((period, index) => ({
      period,
      value: values[index]
    }));

    return `<chart type="line" title="${title}" color="${color}">
<chart-data label="${valueLabel}">
${chartData.map(item => `<point period="${item.period}" value="${item.value}"/>`).join('\n')}
</chart-data>
</chart>`;
  }

  /**
   * Generate a pie chart for distribution/percentage data
   * @param {Object} data - Chart data
   * @param {string} data.title - Chart title
   * @param {Array} data.segments - Array of {label, value, percentage} objects
   * @param {string} data.valueLabel - Label for the values
   * @returns {string} Chart XML
   */
  static generatePieChart({ title, segments, valueLabel = "Amount" }) {
    return `<chart type="pie" title="${title}">
<chart-data label="${valueLabel}">
${segments.map(segment => `<slice label="${segment.label}" value="${segment.value}" percentage="${segment.percentage}"/>`).join('\n')}
</chart-data>
</chart>`;
  }

  /**
   * Generate a multi-series chart for comparing multiple metrics
   * @param {Object} data - Chart data
   * @param {string} data.title - Chart title
   * @param {Array} data.categories - Array of category names
   * @param {Array} data.series - Array of {name, values, color} objects
   * @returns {string} Chart XML
   */
  static generateMultiSeriesChart({ title, categories, series }) {
    return `<chart type="multi-bar" title="${title}">
${series.map(s => `<series name="${s.name}" color="${s.color}">
${categories.map((category, index) => `<bar category="${category}" value="${s.values[index]}"/>`).join('\n')}
</series>`).join('\n')}
</chart>`;
  }

  /**
   * Generate KPI summary cards
   * @param {Array} kpis - Array of {label, value, change, changeType, icon, color} objects
   * @returns {string} Stats XML
   */
  static generateKPICards(kpis) {
    return `<stats>
${kpis.map(kpi => {
  let changeIndicator = '';
  if (kpi.change !== undefined) {
    const changeSymbol = kpi.changeType === 'increase' ? '↗' : '↘';
    const changeColor = kpi.changeType === 'increase' ? 'green' : 'red';
    changeIndicator = ` change="${kpi.change}" change-type="${changeColor}"`;
  }
  return `<stat label="${kpi.label}" value="${kpi.value}" icon="${kpi.icon}" color="${kpi.color}"${changeIndicator}/>`;
}).join('\n')}
</stats>`;
  }

  /**
   * Generate a performance gauge/meter
   * @param {Object} data - Gauge data
   * @param {string} data.title - Gauge title
   * @param {number} data.current - Current value
   * @param {number} data.target - Target value
   * @param {string} data.unit - Unit label (e.g., "$", "%", "units")
   * @returns {string} Gauge XML
   */
  static generatePerformanceGauge({ title, current, target, unit = "" }) {
    const percentage = Math.round((current / target) * 100);
    const status = percentage >= 100 ? 'success' : percentage >= 75 ? 'warning' : 'error';
    
    return `<gauge title="${title}" status="${status}">
<current value="${current}${unit}"/>
<target value="${target}${unit}"/>
<percentage value="${percentage}%"/>
</gauge>`;
  }

  /**
   * Generate a trend indicator
   * @param {Object} data - Trend data
   * @param {string} data.label - Trend label
   * @param {number} data.currentPeriod - Current period value
   * @param {number} data.previousPeriod - Previous period value
   * @param {string} data.unit - Unit label
   * @returns {string} Trend XML
   */
  static generateTrend({ label, currentPeriod, previousPeriod, unit = "" }) {
    const change = currentPeriod - previousPeriod;
    const changePercent = previousPeriod > 0 ? Math.round((change / previousPeriod) * 100) : 0;
    const trendDirection = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    const trendColor = change > 0 ? 'green' : change < 0 ? 'red' : 'yellow';

    return `<trend label="${label}" direction="${trendDirection}" color="${trendColor}">
<current value="${currentPeriod}${unit}"/>
<change value="${Math.abs(change)}${unit}" percentage="${Math.abs(changePercent)}%"/>
</trend>`;
  }
}

/**
 * Report Analytics Helper - Process report data for insights
 */
export class ReportAnalytics {

  /**
   * Analyze sales performance data
   * @param {Array} salesData - Array of sales records
   * @returns {Object} Analytics insights
   */
  static analyzeSalesPerformance(salesData) {
    const totalSales = salesData.reduce((sum, record) => sum + (record.grandTotal || 0), 0);
    const avgSales = salesData.length > 0 ? totalSales / salesData.length : 0;
    
    // Group by status
    const statusBreakdown = salesData.reduce((acc, record) => {
      const status = record.statusDetails?.statusName || 'Unknown';
      acc[status] = (acc[status] || 0) + (record.grandTotal || 0);
      return acc;
    }, {});

    // Monthly trends (if date available)
    const monthlyTrends = this.groupByMonth(salesData, 'issueDate');

    return {
      summary: {
        totalSales,
        avgSales,
        recordCount: salesData.length
      },
      statusBreakdown,
      monthlyTrends
    };
  }

  /**
   * Analyze goal progress
   * @param {Object} goalData - Goal data with targets and actual values
   * @returns {Object} Goal analytics
   */
  static analyzeGoalProgress(goalData) {
    const salesProgress = (goalData.actualSales || 0) / (goalData.targetSales || 1);
    const customerProgress = (goalData.actualCustomers || 0) / (goalData.targetCustomers || 1);

    return {
      salesAchievement: Math.round(salesProgress * 100),
      customerAchievement: Math.round(customerProgress * 100),
      overallScore: Math.round(((salesProgress + customerProgress) / 2) * 100),
      isOnTrack: salesProgress >= 0.75 && customerProgress >= 0.75
    };
  }

  /**
   * Group data by month
   * @param {Array} data - Data array
   * @param {string} dateField - Field name containing date
   * @returns {Object} Monthly grouped data
   */
  static groupByMonth(data, dateField) {
    return data.reduce((acc, record) => {
      if (record[dateField]) {
        const month = record[dateField].substring(0, 7); // YYYY-MM
        if (!acc[month]) {
          acc[month] = { count: 0, total: 0 };
        }
        acc[month].count++;
        acc[month].total += record.grandTotal || 0;
      }
      return acc;
    }, {});
  }

  /**
   * Calculate top performers from data
   * @param {Array} data - Data array
   * @param {string} groupField - Field to group by (e.g., 'customerName', 'employeeName')
   * @param {string} valueField - Field to sum (e.g., 'grandTotal')
   * @param {number} limit - Number of top performers to return
   * @returns {Array} Top performers array
   */
  static getTopPerformers(data, groupField, valueField, limit = 5) {
    const grouped = data.reduce((acc, record) => {
      const key = record[groupField]?.name || record[groupField] || 'Unknown';
      if (!acc[key]) {
        acc[key] = { name: key, total: 0, count: 0 };
      }
      acc[key].total += record[valueField] || 0;
      acc[key].count++;
      return acc;
    }, {});

    return Object.values(grouped)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }
}

/**
 * Format currency values
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default: USD)
 * @returns {string} Formatted currency
 */
export function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount);
}

/**
 * Format percentage values
 * @param {number} value - Decimal value (e.g., 0.75)
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted percentage
 */
export function formatPercentage(value, decimals = 1) {
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Generate executive summary for reports
 * @param {Object} reportData - Report data
 * @param {Object} analytics - Analytics insights
 * @returns {string} Executive summary text
 */
export function generateExecutiveSummary(reportData, analytics) {
  const { summary, statusBreakdown } = analytics;
  const trends = Object.keys(analytics.monthlyTrends || {}).length > 0 ? 'with positive monthly trends' : '';
  
  return `Executive Summary: Generated report shows ${summary.recordCount} records totaling ${formatCurrency(summary.totalSales)} ${trends}. Average transaction value is ${formatCurrency(summary.avgSales)}. Status distribution shows ${Object.keys(statusBreakdown).map(status => `${status}: ${formatCurrency(statusBreakdown[status])}`).join(', ')}.`;
}

/**
 * MANDATORY: Generate complete dashboard with required visual elements
 * This ensures every report includes the minimum required charts and visual components
 * @param {Object} data - Report data
 * @param {string} reportType - Type of report (invoice, estimate, goal)
 * @returns {string} Complete dashboard with all required visual elements
 */
export function generateMandatoryDashboard(data, reportType) {
  const analytics = ReportAnalytics.analyzeSalesPerformance(data);
  let dashboard = '';

  // 1. MANDATORY: Executive Summary
  dashboard += generateExecutiveSummary(data, analytics) + '\n\n';

  // 2. MANDATORY: KPI Cards
  const kpis = [
    {
      label: `Total ${reportType}s`,
      value: analytics.summary.recordCount.toString(),
      icon: 'dollar',
      color: 'blue'
    },
    {
      label: 'Total Value',
      value: formatCurrency(analytics.summary.totalSales),
      icon: 'chart',
      color: 'green'
    },
    {
      label: 'Average Value',
      value: formatCurrency(analytics.summary.avgSales),
      icon: 'package',
      color: 'purple'
    }
  ];
  dashboard += ChartGenerator.generateKPICards(kpis) + '\n\n';

  // 3. MANDATORY: At least one chart
  if (analytics.monthlyTrends && Object.keys(analytics.monthlyTrends).length > 1) {
    // Generate trend chart if we have monthly data
    const months = Object.keys(analytics.monthlyTrends).sort();
    const values = months.map(month => analytics.monthlyTrends[month].total);
    dashboard += ChartGenerator.generateLineChart({
      title: `${reportType} Trends Over Time`,
      periods: months,
      values,
      valueLabel: 'Total ($)',
      color: 'green'
    }) + '\n\n';
  }

  // 4. MANDATORY: Status distribution chart
  if (analytics.statusBreakdown && Object.keys(analytics.statusBreakdown).length > 1) {
    const total = Object.values(analytics.statusBreakdown).reduce((sum, val) => sum + val, 0);
    const segments = Object.entries(analytics.statusBreakdown).map(([status, amount]) => ({
      label: status,
      value: amount,
      percentage: Math.round((amount / total) * 100)
    }));
    
    dashboard += ChartGenerator.generatePieChart({
      title: `${reportType}s by Status`,
      segments,
      valueLabel: 'Amount ($)'
    }) + '\n\n';
  }

  return dashboard;
}

/**
 * Validate that a report response includes mandatory visual elements
 * @param {string} response - Agent response
 * @returns {Object} Validation result with missing elements
 */
export function validateMandatoryCharts(response) {
  const missing = [];
  
  if (!response.includes('<stats>')) {
    missing.push('KPI Cards');
  }
  
  if (!response.includes('<chart>')) {
    missing.push('Charts');
  }
  
  if (!response.includes('<table>')) {
    missing.push('Data Tables');
  }
  
  return {
    isValid: missing.length === 0,
    missing,
    message: missing.length > 0 
      ? `Missing mandatory visual elements: ${missing.join(', ')}` 
      : 'All required visual elements present'
  };
}