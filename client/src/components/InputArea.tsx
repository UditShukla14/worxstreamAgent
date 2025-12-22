import { useState, useCallback, KeyboardEvent, useRef, useEffect, useMemo } from 'react';
import { SendHorizontal } from './icons/AnimatedIcons';
import { extractKeywords, getKeywordDisplayName, getKeywordColor } from '../utils/extractKeywords';

interface InputAreaProps {
  onSend: (message: string, files?: { oldFile?: File; newFile?: File }) => void;
  disabled?: boolean;
}

type ToolMode = 'none' | 'price-compare';

export function InputArea({ onSend, disabled }: InputAreaProps) {
  const [input, setInput] = useState('');
  const [selectedTool, setSelectedTool] = useState<ToolMode>('none');
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const oldFileInputRef = useRef<HTMLInputElement>(null);
  const newFileInputRef = useRef<HTMLInputElement>(null);

  // Extract keywords from input
  const keywords = useMemo(() => {
    return extractKeywords(input);
  }, [input]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSend = useCallback(() => {
    if (selectedTool === 'price-compare') {
      if (!oldFile || !newFile) {
        alert('Please select both old and new files for comparison');
        return;
      }
      onSend(input.trim() || 'Compare these stock files', { oldFile, newFile });
      // Reset after send
      setSelectedTool('none');
      setOldFile(null);
      setNewFile(null);
      setInput('');
      if (oldFileInputRef.current) oldFileInputRef.current.value = '';
      if (newFileInputRef.current) newFileInputRef.current.value = '';
    } else {
      if (input.trim() && !disabled) {
        onSend(input.trim());
        setInput('');
      }
    }
  }, [input, disabled, onSend, selectedTool, oldFile, newFile]);

  const handleToolChange = (tool: ToolMode) => {
    setSelectedTool(tool);
    if (tool === 'none') {
      setOldFile(null);
      setNewFile(null);
      if (oldFileInputRef.current) oldFileInputRef.current.value = '';
      if (newFileInputRef.current) newFileInputRef.current.value = '';
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="input-area">
      {/* Tool Selection Dropdown */}
      <div className="tool-selector" style={{ marginBottom: '8px' }}>
        <select
          value={selectedTool}
          onChange={(e) => handleToolChange(e.target.value as ToolMode)}
          disabled={disabled}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
            width: '100%',
            maxWidth: '300px'
          }}
        >
          <option value="none">Select a tool...</option>
          <option value="price-compare">Price Compare</option>
        </select>
      </div>

      {/* File Upload Section for Price Compare */}
      {selectedTool === 'price-compare' && (
        <div className="file-upload-section" style={{ 
          marginBottom: '12px', 
          padding: '12px', 
          backgroundColor: '#f9fafb', 
          borderRadius: '8px',
          border: '1px solid #e5e7eb'
        }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
              Old Price File:
            </label>
            <input
              ref={oldFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setOldFile(e.target.files?.[0] || null)}
              disabled={disabled}
              style={{ fontSize: '14px' }}
            />
            {oldFile && (
              <span style={{ marginLeft: '8px', fontSize: '12px', color: '#059669' }}>
                ✓ {oldFile.name}
              </span>
            )}
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
              New Price File:
            </label>
            <input
              ref={newFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setNewFile(e.target.files?.[0] || null)}
              disabled={disabled}
              style={{ fontSize: '14px' }}
            />
            {newFile && (
              <span style={{ marginLeft: '8px', fontSize: '12px', color: '#059669' }}>
                ✓ {newFile.name}
              </span>
            )}
          </div>
        </div>
      )}

      {keywords.length > 0 && (
        <div className="input-keywords-preview">
          <span className="keywords-label">Filtering:</span>
          {keywords.map((keyword, index) => (
            <span 
              key={index} 
              className={`keyword-badge ${getKeywordColor(keyword)}`}
              title={`Will filter tools for ${getKeywordDisplayName(keyword)}`}
            >
              {getKeywordDisplayName(keyword)}
            </span>
          ))}
        </div>
      )}
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedTool === 'price-compare' 
              ? "Optional: Ask a question about the comparison..." 
              : "Message Worxstream... (use @customer, @product, etc. to filter tools)"
          }
          disabled={disabled}
          rows={1}
        />
        <button 
          className="send-btn" 
          onClick={handleSend} 
          disabled={
            disabled || 
            (selectedTool === 'price-compare' ? (!oldFile || !newFile) : !input.trim())
          }
          aria-label="Send message"
        >
          <SendHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
