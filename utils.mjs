import fs from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_FILE = join(__dirname, 'logs', 'scraper.log');
const HEARTBEAT_FILE = join(__dirname, 'data', 'heartbeat.json');
const STATS_FILE = join(__dirname, 'data', 'scraper-stats.json');
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Generate a random delay between min and max milliseconds (for human-like behavior)
 */
export function humanDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Append a timestamped message to the log file
 */
export async function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  try {
    await fs.appendFile(LOG_FILE, logMessage, 'utf-8');
  } catch (error) {
    console.error('Failed to write to log file:', error.message);
  }

  // Also log to console for debugging
  console.log(logMessage.trim());
}

/**
 * Get current time in Mountain Time zone
 */
export function getCurrentMountainTime() {
  // Create a date in Mountain Time (America/Denver)
  const now = new Date();
  const mtTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  return mtTime;
}

/**
 * Check if current time is within operating hours
 * Operating hours: 5 AM - 11 PM Mountain Time, Every day
 */
export function isOperatingHours() {
  const now = getCurrentMountainTime();
  const hour = now.getHours();

  // Run every day between 5 AM and 11 PM
  const isActiveHours = hour >= 5 && hour < 23; // 5 AM to 11 PM (< 23 means up to 10:59 PM)

  return isActiveHours;
}

/**
 * Create a unique hash for a job based on date, school, and position
 * This is used to track which jobs we've already notified about
 */
export function createJobHash(job) {
  const hashString = `${job.date}-${job.school}-${job.position}`.toLowerCase();
  return crypto.createHash('md5').update(hashString).digest('hex');
}

/**
 * Ensure required directories exist (data, debug, logs)
 */
export async function ensureDirectories() {
  const dirs = [
    join(__dirname, 'data'),
    join(__dirname, 'debug'),
    join(__dirname, 'logs')
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error.message);
    }
  }
}

/**
 * Clean up old debug files (screenshots and HTML dumps)
 * Keeps files from the last N days, deletes older ones
 */
export async function cleanupOldDebugFiles(maxAgeDays = 3) {
  const debugDir = join(__dirname, 'debug');
  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  try {
    const files = await fs.readdir(debugDir);
    let deletedCount = 0;

    for (const file of files) {
      // Only clean up screenshot and HTML files, skip .gitkeep
      if ((file.endsWith('.png') || file.endsWith('.html')) && file !== '.gitkeep') {
        const filePath = join(debugDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      await logToFile(`🗑️  Cleaned up ${deletedCount} old debug files (older than ${maxAgeDays} days)`);
    }
  } catch (error) {
    await logToFile(`Failed to cleanup old debug files: ${error.message}`);
  }
}

/**
 * Write heartbeat data for external health monitoring.
 * Dashboard can check if timestamp is stale (>2 min = daemon stuck).
 */
export async function writeHeartbeat(data = {}) {
  const heartbeat = {
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    pid: process.pid,
    ...data,
  };

  try {
    await fs.writeFile(HEARTBEAT_FILE, JSON.stringify(heartbeat, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write heartbeat:', error.message);
  }
}

/**
 * Rotate log file if it exceeds max size.
 * Renames current log to .old and starts fresh.
 */
export async function rotateLogIfNeeded() {
  try {
    const stats = await fs.stat(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE_BYTES) {
      const oldLog = LOG_FILE.replace('.log', '.old.log');
      await fs.unlink(oldLog).catch(() => {});
      await fs.rename(LOG_FILE, oldLog);
      await logToFile('Log file rotated (previous log saved as scraper.old.log)');
    }
  } catch (error) {
    // File might not exist yet, that's fine
  }
}

/**
 * Write scraper run stats for the monitoring dashboard.
 * Called after each scrape cycle.
 */
export async function writeScraperStats(stats) {
  try {
    await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write scraper stats:', error.message);
  }
}

/**
 * Load existing scraper stats from disk (for persistence across restarts).
 */
export async function loadScraperStats() {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}
