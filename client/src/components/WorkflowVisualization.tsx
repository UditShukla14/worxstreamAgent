import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Folder,
  Building2,
  Clipboard,
  Receipt,
  Check,
  CreditCard,
  Package,
  FileText,
} from './icons/AnimatedIcons';

interface WorkflowNode {
  id: number;
  appName?: string;
  app_name?: string;
  details?: {
    id?: number;
    customNumber?: string | null;
    name?: string;
    jobName?: string;
    customerName?: string;
    status?: string;
    grandTotal?: string;
    startDate?: string;
    endDate?: string;
    // Deposit nodes (appName === 'deposit')
    depositType?: string;
    depositTotal?: number;
    paymentStatus?: number;
    paymentMethod?: string;
    paymentDate?: string;
  };
  childObject?: WorkflowNode[];
  children?: WorkflowNode[];
  tasks?: Array<{
    id: number;
    title: string;
    status: string;
    startDate?: string;
    endDate?: string;
  }>;
}

interface WorkflowVisualizationProps {
  data: WorkflowNode | WorkflowNode[] | any;
  height?: number;
}

// Get app icon component
const getAppIcon = (appName: string) => {
  const icons: Record<string, React.ReactElement> = {
    project: <Folder size={20} />,
    job: <Building2 size={20} />,
    estimate: <Clipboard size={20} />,
    invoice: <Receipt size={20} />,
    task: <Check size={20} />,
    bill: <CreditCard size={20} />,
    purchase_order: <Package size={20} />,
    deposit: <CreditCard size={20} />,
  };
  return icons[appName?.toLowerCase()] || <FileText size={20} />;
};

// Get app name color classes
const getAppNameColor = (appName: string): string => {
  const lowerName = appName.toLowerCase();
  switch (lowerName) {
    case 'estimate':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'invoice':
      return 'bg-green-50 text-green-700 border-green-200';
    case 'job':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'project':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'task':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'bill':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'purchase_order':
      return 'bg-cyan-50 text-cyan-700 border-cyan-200';
    case 'deposit':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200';
  }
};

// Get icon color
const getIconColor = (appName: string): string => {
  const lowerName = appName.toLowerCase();
  switch (lowerName) {
    case 'estimate':
      return 'text-blue-500';
    case 'invoice':
      return 'text-green-500';
    case 'job':
      return 'text-purple-500';
    case 'project':
      return 'text-orange-500';
    case 'task':
      return 'text-indigo-500';
    case 'bill':
      return 'text-red-500';
    case 'purchase_order':
      return 'text-cyan-500';
    case 'deposit':
      return 'text-emerald-500';
    default:
      return 'text-gray-500';
  }
};

// Format date
function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).replace(/\//g, '/');
  } catch {
    return dateStr;
  }
}

// Get display name for a node
function getNodeDisplayName(node: WorkflowNode): string {
  if (!node) return 'Unknown';
  
  const details = node.details;
  const appName = (node.appName || node.app_name || '').toLowerCase();
  
  if (details) {
    if (appName === 'deposit') return details.paymentMethod || 'Deposit';
    if (details.customNumber) return details.customNumber;
    if (details.jobName) return details.jobName;
    if (details.name) return details.name;
  }
  
  const nodeId = node.id;
  
  if (appName && nodeId) {
    return `${appName} #${nodeId}`;
  }
  if (nodeId) {
    return `#${nodeId}`;
  }
  if (appName) {
    return appName;
  }
  
  return 'Unknown';
}

// Get status badge classes
function getStatusBadgeClasses(status: string): string {
  const lowerStatus = status.toLowerCase();
  if (lowerStatus.includes('paid') || lowerStatus.includes('approved') || lowerStatus.includes('completed') || lowerStatus.includes('closed')) {
    return 'bg-green-100 text-green-700 border-green-300';
  } else if (lowerStatus.includes('pending') || lowerStatus.includes('draft') || lowerStatus.includes('open') || lowerStatus.includes('sent')) {
    return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  } else if (lowerStatus.includes('rejected') || lowerStatus.includes('cancelled')) {
    return 'bg-red-100 text-red-700 border-red-300';
  }
  return 'bg-gray-100 text-gray-700 border-gray-300';
}

// Document Node Component
const DocumentNode = ({ data }: { 
  data: { 
    label: string; 
    appName: string; 
    id: number; 
    customNumber?: string; 
    customerName?: string;
    status?: string;
    grandTotal?: string;
    name?: string;
    jobName?: string;
    startDate?: string | null;
    endDate?: string | null;
    hasIncoming?: boolean;
    hasOutgoing?: boolean;
  } 
}) => {
  const appNameDisplay = data.appName.charAt(0).toUpperCase() + data.appName.slice(1);
  const displayName = data.customNumber || data.name || data.jobName || data.label;
  const iconColor = getIconColor(data.appName);
  const appNameColor = getAppNameColor(data.appName);

  return (
    <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 hover:shadow-xl transition-all duration-200 min-w-[280px] max-w-[320px] relative overflow-hidden">
      {/* Source handle (right side) - for outgoing connections */}
      {data.hasOutgoing && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ zIndex: 999 }}
        />
      )}
      
      {/* Target handle (left side) - for incoming connections */}
      {data.hasIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ zIndex: 999 }}
        />
      )}
      
      {/* Header Section */}
      <div className="px-4 pt-4 pb-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={`p-1.5 rounded-lg bg-white border border-gray-200 shadow-sm ${iconColor}`}>
            {getAppIcon(data.appName)}
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-md border ${appNameColor}`}>
            {appNameDisplay}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-base font-bold text-gray-900">
            {displayName}
          </div>
          <div className="flex items-center gap-3">
            {data.grandTotal && (
              <span className="text-sm font-bold text-gray-900 flex items-center gap-1">
                ${parseFloat(String(data.grandTotal)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
            {data.status && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getStatusBadgeClasses(data.status)} capitalize`}>
                {data.status}
              </span>
            )}
          </div>
        </div>
      </div>
      
      {/* Content Section */}
      <div className="px-4 py-3 space-y-3">
        {/* Customer Information */}
        {data.customerName && (
          <div className="flex items-center gap-2.5">
            <div className="text-gray-400 flex-shrink-0">
              <FileText size={16} />
            </div>
            <div className="flex-1 space-y-1">
              <div className="text-sm font-semibold text-gray-900">
                {data.customerName}
              </div>
            </div>
          </div>
        )}
        
        {/* Name/Job Name for Projects and Jobs */}
        {(data.name || data.jobName) && !data.customerName && (
          <div className="flex items-center gap-2.5">
            <div className="text-gray-400 flex-shrink-0">
              <FileText size={16} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-900">
                {data.name || data.jobName}
              </div>
              {(data.startDate || data.endDate) && (
                <div className="flex items-center gap-3 flex-wrap mt-1">
                  {data.startDate && (
                    <div className="text-xs text-gray-600">
                      Start: {formatDate(data.startDate)}
                    </div>
                  )}
                  {data.endDate && (
                    <div className="text-xs text-gray-600">
                      End: {formatDate(data.endDate)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Dates for other nodes */}
        {(data.startDate || data.endDate) && !data.name && !data.jobName && (
          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600">
            {data.startDate && (
              <div>Start: {formatDate(data.startDate)}</div>
            )}
            {data.endDate && (
              <div>End: {formatDate(data.endDate)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Task Node Component
const TaskNode = ({ data }: { 
  data: { 
    task: {
      id: number;
      title: string;
      status: string;
      startDate?: string;
      endDate?: string;
    };
    hasIncoming?: boolean;
  } 
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md border-2 border-gray-200 hover:shadow-lg transition-all duration-200 min-w-[200px] max-w-[240px] relative overflow-hidden">
      {/* Target handle (left side) - for incoming connections */}
      {data.hasIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white"
          style={{ zIndex: 999 }}
        />
      )}
      
      {/* Header Section */}
      <div className="px-3 pt-3 pb-2 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1 rounded-lg bg-white border border-gray-200 shadow-sm text-indigo-500">
            <Check size={16} />
          </div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-md border bg-indigo-50 text-indigo-700 border-indigo-200">
            Task
          </span>
        </div>
        <div className="text-sm font-bold text-gray-900">
          {data.task.title}
        </div>
      </div>
      
      {/* Content Section */}
      <div className="px-3 py-2 space-y-2">
        {data.task.status && (
          <div className="text-xs">
            <span className="font-medium text-gray-600">Status:</span>{' '}
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              data.task.status.toLowerCase() === 'completed' 
                ? 'bg-green-100 text-green-700 border border-green-300' 
                : data.task.status.toLowerCase() === 'in progress'
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'bg-gray-100 text-gray-700 border border-gray-300'
            }`}>
              {data.task.status}
            </span>
          </div>
        )}
        {(data.task.startDate || data.task.endDate) && (
          <div className="text-xs text-gray-600 space-y-0.5">
            {data.task.startDate && (
              <div>
                <span className="font-medium">Start:</span> {formatDate(data.task.startDate)}
              </div>
            )}
            {data.task.endDate && (
              <div>
                <span className="font-medium">End:</span> {formatDate(data.task.endDate)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const nodeTypes = {
  document: DocumentNode,
  task: TaskNode,
};

// ── Tree layout (horizontal): each leaf gets one vertical "slot"; parents
// center on the vertical span of their subtree, so siblings never overlap. ──
const X_SPACING = 380;
const SLOT_HEIGHT = 230;

function normalizeNodeId(value: unknown): number | null {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (!isNaN(n)) return n;
  }
  return null;
}

/**
 * Lay out a node and its subtree. Returns the number of slots consumed.
 * Tasks render as their own leaf nodes (level + 1, dashed edge).
 */
function layoutNode(
  node: WorkflowNode | any,
  parentId: string | null,
  level: number,
  topSlot: number,
  visited: Set<number>,
  nodes: Node[],
  edges: Edge[]
): number {
  if (!node || typeof node !== 'object') return 0;

  const numericId = normalizeNodeId(node.id);
  if (numericId == null) {
    console.warn('WorkflowVisualization: invalid node id:', node);
    return 0;
  }
  if (visited.has(numericId)) return 0; // cycle guard
  visited.add(numericId);

  const nodeId = `node-${numericId}`;
  const appName = (node.appName || node.app_name || 'unknown').toLowerCase();
  const details = node.details || {};
  const isDeposit = appName === 'deposit';

  const tasks: any[] = Array.isArray(node.tasks) ? node.tasks : [];
  const children: any[] = Array.isArray(node.childObject)
    ? node.childObject
    : Array.isArray(node.children) ? node.children : [];

  // Lay out descendants first so we know the subtree's vertical span.
  let cursor = topSlot;

  for (const task of tasks) {
    if (!task || typeof task !== 'object' || !task.id) continue;
    const taskId = `task-${task.id}-${numericId}`;
    nodes.push({
      id: taskId,
      type: 'task',
      position: { x: (level + 1) * X_SPACING, y: cursor * SLOT_HEIGHT },
      data: { task, hasIncoming: true },
    });
    edges.push({
      id: `edge-${nodeId}-${taskId}`,
      source: nodeId,
      target: taskId,
      type: 'smoothstep',
      animated: false,
      style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.6, strokeDasharray: '5,5' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6', width: 18, height: 18 },
    });
    cursor += 1;
  }

  for (const child of children) {
    cursor += layoutNode(child, nodeId, level + 1, cursor, visited, nodes, edges);
  }

  const consumed = Math.max(1, cursor - topSlot);
  const y = (topSlot + consumed / 2 - 0.5) * SLOT_HEIGHT;

  // Deposit nodes carry payment fields instead of document fields — map them
  // onto the card's display slots.
  const depositStatus = isDeposit
    ? (details.paymentStatus === 1 ? 'Paid' : 'Pending')
    : undefined;
  const depositLabel = isDeposit
    ? [details.depositType === 'partial' ? 'Partial deposit' : 'Deposit', details.paymentDate]
        .filter(Boolean)
        .join(' — ')
    : undefined;

  nodes.push({
    id: nodeId,
    type: 'document',
    position: { x: level * X_SPACING, y },
    data: {
      label: getNodeDisplayName(node),
      customNumber: details.customNumber,
      appName,
      id: numericId,
      customerName: details.customerName,
      status: details.status ?? depositStatus,
      grandTotal: details.grandTotal ?? (isDeposit && details.depositTotal != null ? String(details.depositTotal) : undefined),
      name: details.name ?? depositLabel,
      jobName: details.jobName,
      startDate: details.startDate,
      endDate: details.endDate,
      hasIncoming: parentId !== null,
      hasOutgoing: tasks.length > 0 || children.length > 0,
    },
  });

  if (parentId) {
    edges.push({
      id: `edge-${parentId}-${nodeId}`,
      source: parentId,
      target: nodeId,
      type: 'smoothstep',
      animated: false,
      style: { stroke: '#6366f1', strokeWidth: 2.5, opacity: 0.75 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1', width: 20, height: 20 },
    });
  }

  return consumed;
}

export function WorkflowVisualization({
  data,
  height = 500,
}: WorkflowVisualizationProps) {
  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };

    const roots = Array.isArray(data) ? data : [data];
    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];
    const visited = new Set<number>();
    let slotCursor = 0;

    for (const root of roots) {
      if (!root || typeof root !== 'object') continue;
      slotCursor += layoutNode(root, null, 0, slotCursor, visited, allNodes, allEdges);
    }

    return { nodes: allNodes, edges: allEdges };
  }, [data]);

  if (nodes.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border-2 border-dashed border-gray-200 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100/50">
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center mb-2">
            <FileText size={24} className="text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-600">No workflow data to display</p>
          <p className="text-xs text-gray-400">Workflow information will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full border border-gray-200 rounded-xl overflow-hidden bg-gradient-to-br from-gray-50/50 to-white"
      style={{ height: `${height}px` }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        panOnDrag={true}
        panOnScroll={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        fitViewOptions={{ padding: 0.25, maxZoom: 1.5, minZoom: 0.2 }}
        defaultViewport={{ x: 30, y: 30, zoom: 0.9 }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background 
          color="#d1d5db" 
          gap={16} 
          size={1}
        />
        <Controls 
          showInteractive={false}
          className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg"
        />
      </ReactFlow>
    </div>
  );
}
