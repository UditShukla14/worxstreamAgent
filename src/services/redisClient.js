/**
 * Redis client wrapper.
 *
 * - Optional: if REDIS_URL is not set, all helpers become no-ops.
 * - Safe: errors are swallowed so Redis outages don't break agent flows.
 * - Commands time out so a half-dead socket cannot hang MCP tool turns
 *   (e.g. send_sms write-confirm stuck after "→ send_sms" with no Executing log).
 */
import { createClient } from 'redis';
import { config } from '../config/index.js';

let clientPromise = null;
let isReady = false;

const COMMAND_TIMEOUT_MS = Math.max(
  500,
  parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS || '3000', 10) || 3000,
);

function isEnabled() {
  return Boolean(config.redis?.url);
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis ${label} timed out after ${COMMAND_TIMEOUT_MS}ms`)),
          COMMAND_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getClient() {
  if (!isEnabled()) return null;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const url = config.redis.url;
    const socket = {
      connectTimeout: COMMAND_TIMEOUT_MS,
    };
    /** `rediss://` (e.g. DigitalOcean Valkey) or explicit REDIS_TLS=true with `redis://`. */
    const useTls = url.startsWith('rediss:') || config.redis.tls === true;
    if (useTls) {
      socket.tls = true;
      if (config.redis.rejectUnauthorized === false) {
        socket.rejectUnauthorized = false;
      }
    }

    const c = createClient({
      url,
      database: config.redis.db,
      socket,
      commandsQueueMaxLength: 1000,
    });

    c.on('error', (err) => {
      // Never throw from here — Redis is an optimization.
      console.warn('⚠️ Redis error:', err?.message || err);
      isReady = false;
    });

    c.on('ready', () => {
      isReady = true;
      console.log('🧠 Redis ready');
    });

    c.on('end', () => {
      isReady = false;
      console.warn('⚠️ Redis connection closed');
    });

    try {
      await withTimeout(c.connect(), 'connect');
      return c;
    } catch (err) {
      console.warn('⚠️ Redis connect failed:', err?.message || err);
      isReady = false;
      clientPromise = null;
      try {
        c.destroy?.();
      } catch {
        /* ignore */
      }
      return null;
    }
  })();

  return clientPromise;
}

export function redisStatus() {
  return {
    enabled: isEnabled(),
    ready: isReady,
  };
}

export async function redisGet(key) {
  try {
    const c = await getClient();
    if (!c || !isReady) return null;
    return await withTimeout(c.get(key), 'get');
  } catch (err) {
    console.warn('⚠️ Redis get failed:', err?.message || err);
    return null;
  }
}

export async function redisSet(key, value, { ex } = {}) {
  try {
    const c = await getClient();
    if (!c || !isReady) return false;
    if (typeof ex === 'number' && Number.isFinite(ex) && ex > 0) {
      await withTimeout(c.set(key, value, { EX: ex }), 'set');
    } else {
      await withTimeout(c.set(key, value), 'set');
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Redis set failed:', err?.message || err);
    return false;
  }
}

export async function redisDel(key) {
  try {
    const c = await getClient();
    if (!c || !isReady) return 0;
    return await withTimeout(c.del(key), 'del');
  } catch (err) {
    console.warn('⚠️ Redis del failed:', err?.message || err);
    return 0;
  }
}
