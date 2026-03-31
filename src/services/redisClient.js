/**
 * Redis client wrapper.
 *
 * - Optional: if REDIS_URL is not set, all helpers become no-ops.
 * - Safe: errors are swallowed so Redis outages don't break agent flows.
 */
import { createClient } from 'redis';
import { config } from '../config/index.js';
 
let clientPromise = null;
let isReady = false;
 
function isEnabled() {
  return Boolean(config.redis?.url);
}
 
async function getClient() {
  if (!isEnabled()) return null;
  if (clientPromise) return clientPromise;
 
  clientPromise = (async () => {
    const url = config.redis.url;
    const socket = {};
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
      socket: Object.keys(socket).length > 0 ? socket : undefined,
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
      await c.connect();
      return c;
    } catch (err) {
      console.warn('⚠️ Redis connect failed:', err?.message || err);
      isReady = false;
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
    if (!c) return null;
    return await c.get(key);
  } catch {
    return null;
  }
}
 
export async function redisSet(key, value, { ex } = {}) {
  try {
    const c = await getClient();
    if (!c) return false;
    if (typeof ex === 'number' && Number.isFinite(ex) && ex > 0) {
      await c.set(key, value, { EX: ex });
    } else {
      await c.set(key, value);
    }
    return true;
  } catch {
    return false;
  }
}
 
export async function redisDel(key) {
  try {
    const c = await getClient();
    if (!c) return 0;
    return await c.del(key);
  } catch {
    return 0;
  }
}
 
 