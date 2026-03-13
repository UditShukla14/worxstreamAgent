import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let cachedSoul = null;

function loadSoulFromDisk() {
  if (cachedSoul !== null) return cachedSoul;

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const soulPath = path.resolve(__dirname, '..', '..', 'SOUL.md');
    const text = fs.readFileSync(soulPath, 'utf8');
    // Keep it as plain text; callers can prepend it to system prompts.
    cachedSoul = text.trim();
  } catch (err) {
    console.warn('⚠️ SOUL.md not found or unreadable; proceeding without soul layer.', err?.message || err);
    cachedSoul = '';
  }

  return cachedSoul;
}

/**
 * Returns the soul text to prepend to agent system prompts.
 * If SOUL.md is missing, returns an empty string.
 */
export function getSoulSystemPrompt() {
  return loadSoulFromDisk();
}

