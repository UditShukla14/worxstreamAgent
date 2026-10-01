/** Internal marker used to prevent malformed model output from reaching tools. */
export const INVALID_TOOL_ARGUMENTS_KEY = '__invalid_tool_arguments';

/** Parse JSON arguments from an OpenAI function tool call. */
export function parseToolArguments(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = String(value).trim();
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return { [INVALID_TOOL_ARGUMENTS_KEY]: 'Tool arguments must be a JSON object.', raw };
  } catch (error) {
    return {
      [INVALID_TOOL_ARGUMENTS_KEY]: `Invalid JSON tool arguments: ${error.message}`,
      raw,
    };
  }
}
