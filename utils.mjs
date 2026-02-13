import fs from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_FILE = join(__dirname, 'logs', 'scraper.log');

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
