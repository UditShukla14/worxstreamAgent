/**
 * Extract workflow data from message content
 */

interface WorkflowNode {
  id: number;
  appName?: string;
  app_name?: string;
  details?: any;
  childObject?: WorkflowNode[];
  children?: WorkflowNode[];
  tasks?: any[];
}

export function extractWorkflowData(content: string): WorkflowNode | WorkflowNode[] | null {
  try {
    // Try to find JSON data blocks in the content
    // Look for code blocks or JSON objects
    const jsonBlockPattern = /```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/g;
    let match;
    
    while ((match = jsonBlockPattern.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        const workflowData = findWorkflowData(parsed);
        if (workflowData) return workflowData;
      } catch {
        // Not valid JSON, continue
      }
    }

    // Try to find JSON objects directly in content (larger objects)
    const jsonObjectPattern = /\{[\s\S]{50,10000}\}/g;
    while ((match = jsonObjectPattern.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        const workflowData = findWorkflowData(parsed);
        if (workflowData) return workflowData;
      } catch {
        // Not valid JSON, continue
      }
    }

    // Try to find "data" field in JSON responses
    const dataPattern = /"data"\s*:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/;
    const dataMatch = content.match(dataPattern);
    if (dataMatch) {
      try {
        // Try to extract just the data array/object
        let jsonStr = dataMatch[1];
        // Handle nested objects - try to find complete JSON
        const fullJsonMatch = content.match(/\{[\s\S]*?"data"\s*:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})[\s\S]*?\}/);
        if (fullJsonMatch) {
          try {
            const fullParsed = JSON.parse(fullJsonMatch[0]);
            const workflowData = findWorkflowData(fullParsed);
            if (workflowData) return workflowData;
          } catch {
            // Fall through to try just the data part
          }
        }
        
        const parsed = JSON.parse(jsonStr);
        const workflowData = findWorkflowData(parsed);
        if (workflowData) return workflowData;
      } catch {
        // Not valid JSON
      }
    }

    // Try to find complete JSON response with "success" and "data"
    const completeJsonPattern = /\{\s*"success"\s*:\s*true[\s\S]*?"data"\s*:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})[\s\S]*?\}/;
    const completeMatch = content.match(completeJsonPattern);
    if (completeMatch) {
      try {
        const fullJson = completeMatch[0];
        const parsed = JSON.parse(fullJson);
        const workflowData = findWorkflowData(parsed);
        if (workflowData) return workflowData;
      } catch {
        // Not valid JSON
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Recursively find workflow data in parsed JSON
 */
function findWorkflowData(obj: any): WorkflowNode | WorkflowNode[] | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  // Check if this object itself is a workflow node (has appName or app_name)
  if (obj.appName || obj.app_name || obj.childObject || obj.children) {
    return obj as WorkflowNode;
  }

  // Check if it's a response object with "data" field
  if (obj.data) {
    const dataResult = findWorkflowData(obj.data);
    if (dataResult) return dataResult;
  }

  // Check if it's an array of workflow nodes
  if (Array.isArray(obj)) {
    if (obj.length > 0 && (obj[0].appName || obj[0].app_name || obj[0].childObject || obj[0].children)) {
      return obj as WorkflowNode[];
    }
    // Recursively check array items
    for (const item of obj) {
      const found = findWorkflowData(item);
      if (found) return found;
    }
  }

  // Check nested objects
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const found = findWorkflowData(obj[key]);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Check if content contains workflow-related keywords
 */
export function hasWorkflowContent(content: string): boolean {
  const workflowKeywords = [
    'workflow',
    'object_tree',
    'workflow tree',
    'document flow',
    'appname',
    'app_name',
    'childobject',
    'child_object',
    'parent_object',
    'workflow_type',
    'get_workflow_object_tree',
  ];
  
  const lowerContent = content.toLowerCase();
  return workflowKeywords.some(keyword => lowerContent.includes(keyword)) ||
         /"appName"\s*:/.test(content) ||
         /"app_name"\s*:/.test(content) ||
         /"childObject"\s*:/.test(content);
}
