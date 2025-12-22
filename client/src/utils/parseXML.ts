import { Milestone } from '../components/Milestones';

// Icon mapping
const iconMap: Record<string, string> = {
  users: '👥',
  package: '📦',
  dollar: '💰',
  building: '🏢',
  chart: '📊',
  calendar: '📅',
  mail: '📧',
  phone: '📞',
  tag: '🏷️',
  folder: '📁',
  check: '✅',
  warning: '⚠️',
  error: '❌',
  info: 'ℹ️',
  success: '✅',
};

export function getIcon(name: string): string {
  return iconMap[name] || '📌';
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Parse HTML attributes from a string
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!attrString) return attrs;
  
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

// Extract workflow data from <workflow> tags
export function extractWorkflowFromXML(content: string): any | null {
  const workflowMatch = content.match(/<workflow\s*([^>]*)>([\s\S]*?)<\/workflow>/i);
  if (!workflowMatch) return null;

  try {
    const jsonContent = workflowMatch[2].trim();
    const workflowData = JSON.parse(jsonContent);
    
    // Handle API response structure: { success: true, data: [...] }
    if (workflowData && typeof workflowData === 'object') {
      if (workflowData.data) {
        // Return the data array/object directly
        return workflowData.data;
      }
      // If it's already the data structure, return as-is
      return workflowData;
    }
    
    return workflowData;
  } catch (error) {
    console.error('Failed to parse workflow JSON:', error);
    // Try to find JSON in the content
    const jsonMatch = workflowMatch[2].match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        // Handle API response structure
        if (parsed && parsed.data) {
          return parsed.data;
        }
        return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Extract milestones data from <milestones> tags (handles partial/incomplete content during streaming)
export function extractMilestonesFromXML(content: string): Milestone[] | null {
  if (!content) return null;

  // Try to find complete milestones tag first
  let milestonesMatch = content.match(/<milestones\s*([^>]*)>([\s\S]*?)<\/milestones>/i);
  
  // If not found, try to find incomplete milestones tag (for streaming)
  if (!milestonesMatch) {
    // Look for opening tag without closing tag (streaming in progress)
    const openTagMatch = content.match(/<milestones\s*([^>]*)>([\s\S]*)/i);
    if (openTagMatch) {
      // Use the content up to the current position
      milestonesMatch = openTagMatch;
    } else {
      return null;
    }
  }

  try {
    const innerContent = milestonesMatch[2];
    const milestones: Milestone[] = [];
    
    // Parse individual milestone tags (including incomplete ones during streaming)
    // Match milestone tags even if they're not closed yet
    const milestoneRegex = /<milestone\s+([^>]*)>([\s\S]*?)(?:<\/milestone>|$)/gi;
    let match;
    
    while ((match = milestoneRegex.exec(innerContent)) !== null) {
      const attrs = parseAttributes(match[1]);
      const text = match[2].trim();
      
      // Validate and normalize status
      const statusValue = attrs.status || 'pending';
      const validStatus: Milestone['status'] = 
        (statusValue === 'pending' || statusValue === 'in_progress' || 
         statusValue === 'completed' || statusValue === 'failed')
          ? statusValue
          : 'pending';
      
      // Only add milestone if it has valid attributes (id or status)
      if (attrs.id || attrs.status || text) {
        milestones.push({
          id: attrs.id || String(milestones.length + 1),
          status: validStatus,
          text: text || '...', // Show placeholder if text is empty (streaming)
        });
      }
    }
    
    return milestones.length > 0 ? milestones : null;
  } catch (error) {
    console.error('Failed to parse milestones:', error);
    return null;
  }
}

// Parse XML content and convert to HTML
export function parseXMLContent(content: string): string {
  let html = content;

  // Remove <workflow> tags (they're handled separately for visualization)
  html = html.replace(/<workflow\s*([^>]*)>([\s\S]*?)<\/workflow>/gi, '');

  // Remove <milestones> tags (they're handled separately for milestone display)
  html = html.replace(/<milestones\s*([^>]*)>([\s\S]*?)<\/milestones>/gi, '');

  // Parse <stats> blocks
  html = html.replace(/<stats>([\s\S]*?)<\/stats>/gi, (_match, inner) => {
    const statsHtml: string[] = [];
    const statMatches = inner.matchAll(/<stat\s+([^>]*)\/>/gi);
    for (const m of statMatches) {
      const attrs = parseAttributes(m[1]);
      const color = attrs.color || 'blue';
      const iconName = attrs.icon || 'chart';
      statsHtml.push(`
        <div class="stat-card ${color}">
          <div class="icon icon-${iconName}"></div>
          <div class="value">${escapeHtml(attrs.value || '0')}</div>
          <div class="label">${escapeHtml(attrs.label || '')}</div>
        </div>
      `);
    }
    return `<div class="stats-grid">${statsHtml.join('')}</div>`;
  });

  // Parse <table> blocks
  html = html.replace(/<table\s*([^>]*)>([\s\S]*?)<\/table>/gi, (_match, attrs, inner) => {
    const tableAttrs = parseAttributes(attrs);
    const title = tableAttrs.title || '';
    
    // Parse headers
    const headers: string[] = [];
    const headersMatch = inner.match(/<headers>([\s\S]*?)<\/headers>/i);
    if (headersMatch) {
      const thMatches = headersMatch[1].matchAll(/<th>([^<]*)<\/th>/gi);
      for (const th of thMatches) {
        headers.push(th[1].trim());
      }
    }

    // Parse rows
    const rows: { value: string; status: string | null }[][] = [];
    const rowMatches = inner.matchAll(/<row>([\s\S]*?)<\/row>/gi);
    for (const rowMatch of rowMatches) {
      const cells: { value: string; status: string | null }[] = [];
      const tdMatches = rowMatch[1].matchAll(/<td\s*([^>]*)>([^<]*)<\/td>/gi);
      for (const td of tdMatches) {
        const tdAttrs = parseAttributes(td[1]);
        cells.push({
          value: td[2].trim(),
          status: tdAttrs.status || null
        });
      }
      if (cells.length > 0) rows.push(cells);
    }

    return `
      <div class="data-table">
        ${title ? `<div class="data-table-header"><span class="icon icon-clipboard"></span> ${escapeHtml(title)}</div>` : ''}
        <div class="data-table-wrapper">
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  ${row.map(cell => 
                    cell.status 
                      ? `<td><span class="status-badge ${cell.status}">${escapeHtml(cell.value)}</span></td>`
                      : `<td>${escapeHtml(cell.value)}</td>`
                  ).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });

  // Parse <list> blocks
  html = html.replace(/<list\s*([^>]*)>([\s\S]*?)<\/list>/gi, (_match, attrs, inner) => {
    const listAttrs = parseAttributes(attrs);
    const title = listAttrs.title || '';
    
    const items: { title: string; description: string; badge: string }[] = [];
    const itemMatches = inner.matchAll(/<item\s+([^>]*)\/>/gi);
    for (const item of itemMatches) {
      const itemAttrs = parseAttributes(item[1]);
      items.push({
        title: itemAttrs.title || '',
        description: itemAttrs.description || '',
        badge: itemAttrs.badge || ''
      });
    }

    return `
      <div class="data-list">
        ${title ? `<div class="data-list-header"><span class="icon icon-clipboard"></span> ${escapeHtml(title)}</div>` : ''}
        ${items.map(item => `
          <div class="data-list-item">
            <div class="data-list-item-content">
              <div class="data-list-item-title">${escapeHtml(item.title)}</div>
              ${item.description ? `<div class="data-list-item-desc">${escapeHtml(item.description)}</div>` : ''}
            </div>
            ${item.badge ? `<span class="data-list-item-badge">${escapeHtml(item.badge)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  });

  // Parse <details> blocks
  html = html.replace(/<details\s*([^>]*)>([\s\S]*?)<\/details>/gi, (_match, attrs, inner) => {
    const detailsAttrs = parseAttributes(attrs);
    const title = detailsAttrs.title || '';
    
    const items: { label: string; value: string; badge?: string }[] = [];
    const itemMatches = inner.matchAll(/<item\s+([^>]*)>([\s\S]*?)<\/item>/gi);
    for (const item of itemMatches) {
      const itemAttrs = parseAttributes(item[1]);
      items.push({
        label: itemAttrs.label || '',
        value: item[2].trim(),
        badge: itemAttrs.badge || undefined
      });
    }

    return `
      <div class="details-card">
        ${title ? `<div class="details-card-header"><span class="icon icon-file-text"></span> ${escapeHtml(title)}</div>` : ''}
        <div class="details-card-body">
          ${items.map(item => {
            const valueDisplay = item.badge 
              ? `<span class="status-badge ${item.badge}">${escapeHtml(item.value)}</span>`
              : escapeHtml(item.value);
            return `
            <div class="details-item">
              <span class="details-item-label">${escapeHtml(item.label)}</span>
              <span class="details-item-value">${valueDisplay}</span>
            </div>
          `;
          }).join('')}
        </div>
      </div>
    `;
  });

  // Parse <alert> blocks
  html = html.replace(/<alert\s+type="([^"]*)">([\s\S]*?)<\/alert>/gi, (_match, type, content) => {
    const iconClass = type === 'success' ? 'icon-check-circle' : type === 'error' ? 'icon-alert-circle' : type === 'warning' ? 'icon-alert-circle' : 'icon-info';
    return `<div class="alert ${type}"><span class="icon ${iconClass}"></span> ${escapeHtml(content.trim())}</div>`;
  });

  // Clean up and format remaining text
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Split into paragraphs
  const parts = html.split(/\n\n+/);
  const formattedParts = parts.map(part => {
    part = part.trim();
    if (!part) return '';
    // Don't wrap if it starts with HTML tag
    if (part.startsWith('<div') || part.startsWith('<p')) {
      return part;
    }
    // Wrap plain text in paragraph
    return `<p>${part.replace(/\n/g, '<br>')}</p>`;
  });

  return formattedParts.filter(p => p).join('');
}
