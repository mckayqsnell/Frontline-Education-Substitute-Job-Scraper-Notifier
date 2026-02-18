#!/usr/bin/env node
/**
 * Frontline Education Substitute Job Scraper — Persistent Daemon
 *
 * Runs as a long-lived process managed by launchd (KeepAlive).
 * Checks for new jobs every 30 seconds by refreshing the Available Jobs page.
 * Browser stays open between cycles; restarts every 2 hours for memory hygiene.
 *
 * Architecture:
 *   outerLoop (browser lifecycle): launch → login → innerLoop → close → repeat
 *   innerLoop (scrape cycles): refresh → scrape → filter → notify → sleep 30s
 *
 * Operating hours (5 AM - 11 PM MT): loop sleeps during off-hours, resumes automatically.
 * Signal handling: SIGTERM/SIGINT → graceful shutdown (close browser, exit 0).
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { SELECTORS } from './selectors.mjs';
import { filterJob } from './filters.mjs';
import {
  sendJobNotification,
  sendErrorAlert,
  sendSummaryNotification,
  sendJobNotificationWithKeyboard,
  sendAutoBookNotification,
  pollCallbackQueries,
  answerCallback,
  updateMessageAfterAction,
} from './notify.mjs';
import {
  humanDelay,
  logToFile,
  isOperatingHours,
  createJobHash,
  ensureDirectories,
  cleanupOldDebugFiles,
  writeHeartbeat,
  rotateLogIfNeeded,
  writeScraperStats,
  loadScraperStats,
} from './utils.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// CONSTANTS
// ============================================================================

const NOTIFIED_JOBS_FILE = path.join(__dirname, 'data', 'notified-jobs.json');
const JOB_CARD_DOM_LOG = path.join(__dirname, 'logs', 'job-card-dom-examples.html');

// Daemon loop timing
const SCRAPE_INTERVAL_MS = 30_000;                        // 30 seconds between scrapes
const BROWSER_RESTART_INTERVAL_MS = 2 * 60 * 60 * 1000;  // Restart browser every 2 hours
const OFF_HOURS_SLEEP_MS = 60_000;                        // 60s between off-hours checks
const BROWSER_RESTART_PAUSE_MS = 5_000;                   // 5s pause before browser restart

// Error handling
const MAX_CONSECUTIVE_ERRORS = 5;  // Restart browser after N consecutive scrape failures

// Screenshot throttling (at 30-second intervals, we don't need every cycle)
const SCREENSHOT_EVERY_N_CYCLES = 20;  // Screenshot every ~10 minutes
const CLEANUP_EVERY_N_CYCLES = 120;    // Cleanup every ~60 minutes
const LOG_ROTATE_EVERY_N_CYCLES = 120; // Log rotation check every ~60 minutes

// Data retention
const MAX_JOB_AGE_DAYS = 7;
const DEBUG_FILE_RETENTION_DAYS = 1;  // Reduced from 3 for higher-frequency runs

// Logging
const VERBOSE_LOGGING = false;  // Set to true for detailed per-job logging

// Auto-booking
const AUTO_BOOKING_ENABLED = true;
const NOTIFICATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes — remove keyboard after this
const AUTO_BOOK_MIN_DAYS_AHEAD = 3; // Only auto-book jobs 3+ days away (cancellation buffer)

// ============================================================================
// DAEMON STATE
// ============================================================================

let shutdownRequested = false;

// Screenshot throttling state
let cycleCount = 0;
let previousJobCount = -1;

// Stats tracking (persisted to disk for dashboard)
let scraperStats = null;
const daemonStartTime = new Date().toISOString();

// Telegram callback polling state
let lastUpdateOffset = 0;

// ============================================================================
// AUTO-BOOKING HELPERS
// ============================================================================

/**
 * Parse a job's date and return how many days from now it is.
 * Job date format: "Wed, 2/25/2026" or "2/25/2026"
 * For multi-day jobs, uses the first day's date.
 * Returns -1 if date can't be parsed (treat as "don't auto-book").
 */
function getJobDaysAhead(job) {
  try {
    let dateStr = job.date;
    if (!dateStr || dateStr === 'N/A') return -1;

    // Remove day name prefix: "Wed, 2/25/2026" → "2/25/2026"
    dateStr = dateStr.replace(/^[A-Za-z]+,\s*/, '');
    const jobDate = new Date(dateStr);
    if (isNaN(jobDate.getTime())) return -1;

    // Compare dates in Mountain Time (strip time component)
    const nowMT = new Date(new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' }));
    const jobDateClean = new Date(jobDate.toLocaleDateString('en-US'));

    const diffMs = jobDateClean - nowMT;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return -1;
  }
}

/**
 * Determine if a job should be auto-booked (no human confirmation needed).
 * Requirements: certain match (not uncertain) AND 3+ days away.
 */
function shouldAutoBook(job, uncertain) {
  if (uncertain) return false;
  const daysAhead = getJobDaysAhead(job);
  return daysAhead >= AUTO_BOOK_MIN_DAYS_AHEAD;
}

// ============================================================================
// SIGNAL HANDLING
// ============================================================================

function setupSignalHandlers() {
  const handler = (signal) => {
    logToFile(`Received ${signal}. Shutting down gracefully...`);
    shutdownRequested = true;
  };

  process.on('SIGTERM', handler); // launchd sends this on unload
  process.on('SIGINT', handler);  // Ctrl+C
}

// ============================================================================
// INTERRUPTIBLE SLEEP
// ============================================================================

/**
 * Sleep that can be interrupted by shutdown signal.
 * Checks shutdownRequested every second.
 */
function sleep(ms) {
  return new Promise(resolve => {
    let elapsed = 0;
    const checkInterval = 1000;
    const timer = setInterval(() => {
      elapsed += checkInterval;
      if (elapsed >= ms || shutdownRequested) {
        clearInterval(timer);
        resolve();
      }
    }, checkInterval);
  });
}

// ============================================================================
// NOTIFIED JOBS PERSISTENCE
// ============================================================================

/**
 * Load notified jobs from disk, migrating old format entries.
 * Old format: { hash: timestamp }
 * New format: { hash: { status, timestamp, expiresAt, telegramMessageId, jobData, uncertain } }
 */
async function loadNotifiedJobs() {
  try {
    const data = await fs.readFile(NOTIFIED_JOBS_FILE, 'utf-8');
    const raw = JSON.parse(data);

    // Migrate old format entries (value is a number)
    for (const [hash, value] of Object.entries(raw)) {
      if (typeof value === 'number') {
        raw[hash] = {
          status: 'expired',
          timestamp: value,
          expiresAt: value,
          telegramMessageId: null,
          jobData: null,
          uncertain: false,
        };
      }
    }

    return raw;
  } catch (error) {
    return {};
  }
}

async function saveNotifiedJobs(notifiedJobs) {
  await fs.writeFile(NOTIFIED_JOBS_FILE, JSON.stringify(notifiedJobs, null, 2), 'utf-8');
}

function cleanOldNotifications(notifiedJobs) {
  const cutoffTime = Date.now() - (MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000);
  const cleaned = {};

  for (const [hash, value] of Object.entries(notifiedJobs)) {
    const timestamp = typeof value === 'number' ? value : value.timestamp;
    if (timestamp > cutoffTime) {
      cleaned[hash] = value;
    }
  }

  const removedCount = Object.keys(notifiedJobs).length - Object.keys(cleaned).length;
  if (removedCount > 0) {
    logToFile(`Cleaned up ${removedCount} old job notifications (older than ${MAX_JOB_AGE_DAYS} days)`);
  }

  return cleaned;
}

// ============================================================================
// STATS TRACKING
// ============================================================================

function initStats(existing) {
  const today = new Date().toISOString().split('T')[0];

  if (existing && existing.todayStats && existing.todayStats.date === today) {
    // Resume today's stats (ensure new fields exist for backward compat)
    return {
      ...existing,
      currentStatus: {
        ...existing.currentStatus,
        isRunning: true,
        upSince: daemonStartTime,
      },
      bookingActions: existing.bookingActions || {
        booked: 0, ignored: 0, expired: 0, failed: 0, autoBooked: 0,
        uncertainBooked: 0, uncertainIgnored: 0, uncertainExpired: 0,
      },
    };
  }

  // Start fresh for new day, preserve history
  const history = existing?.history || [];

  // Archive yesterday's stats if they exist
  if (existing?.todayStats && existing.todayStats.date !== today) {
    history.push({
      date: existing.todayStats.date,
      totalChecks: existing.todayStats.totalChecks,
      totalJobsSeen: existing.todayStats.totalJobsSeen,
      totalJobsMatched: existing.todayStats.totalJobsMatched,
      totalJobsNotified: existing.todayStats.totalJobsNotified,
      totalUncertainMatched: existing.todayStats.totalUncertainMatched || 0,
      totalErrors: existing.todayStats.totalErrors,
      bookingActions: existing.bookingActions || {},
    });
    // Keep last 14 days
    while (history.length > 14) history.shift();
  }

  return {
    currentStatus: {
      isRunning: true,
      lastCheckTime: null,
      lastCheckDurationMs: 0,
      browserHealthy: true,
      upSince: daemonStartTime,
    },
    todayStats: {
      date: today,
      totalChecks: 0,
      totalJobsSeen: 0,
      totalJobsMatched: 0,
      totalJobsNotified: 0,
      totalUncertainMatched: 0,
      totalUncertainNotified: 0,
      totalErrors: 0,
    },
    bookingActions: {
      booked: 0,
      ignored: 0,
      expired: 0,
      failed: 0,
      autoBooked: 0,
      uncertainBooked: 0,
      uncertainIgnored: 0,
      uncertainExpired: 0,
    },
    recentChecks: existing?.recentChecks || [],
    recentErrors: existing?.recentErrors || [],
    history,
  };
}

function recordCheck(stats, result) {
  stats.todayStats.totalChecks++;
  stats.todayStats.totalJobsSeen += result.jobsSeen;
  stats.todayStats.totalJobsMatched += result.jobsMatched;
  stats.todayStats.totalJobsNotified += result.jobsNotified;
  stats.todayStats.totalUncertainMatched = (stats.todayStats.totalUncertainMatched || 0) + result.uncertainMatched;
  stats.todayStats.totalUncertainNotified = (stats.todayStats.totalUncertainNotified || 0) + result.uncertainNotified;

  stats.currentStatus.lastCheckTime = new Date().toISOString();
  stats.currentStatus.lastCheckDurationMs = result.durationMs;

  stats.recentChecks.push({
    timestamp: new Date().toISOString(),
    jobsSeen: result.jobsSeen,
    jobsMatched: result.jobsMatched,
    jobsNotified: result.jobsNotified,
    uncertainMatched: result.uncertainMatched,
    durationMs: result.durationMs,
    error: null,
  });

  // Keep last 100 checks
  while (stats.recentChecks.length > 100) stats.recentChecks.shift();

  // Roll over to new day if needed
  const today = new Date().toISOString().split('T')[0];
  if (stats.todayStats.date !== today) {
    // Archive yesterday
    stats.history.push({
      date: stats.todayStats.date,
      totalChecks: stats.todayStats.totalChecks,
      totalJobsSeen: stats.todayStats.totalJobsSeen,
      totalJobsMatched: stats.todayStats.totalJobsMatched,
      totalJobsNotified: stats.todayStats.totalJobsNotified,
      totalUncertainMatched: stats.todayStats.totalUncertainMatched || 0,
      totalErrors: stats.todayStats.totalErrors,
      bookingActions: { ...stats.bookingActions },
    });
    while (stats.history.length > 14) stats.history.shift();

    // Reset today
    stats.todayStats = {
      date: today,
      totalChecks: 1,
      totalJobsSeen: result.jobsSeen,
      totalJobsMatched: result.jobsMatched,
      totalJobsNotified: result.jobsNotified,
      totalUncertainMatched: result.uncertainMatched,
      totalUncertainNotified: result.uncertainNotified,
      totalErrors: 0,
    };
    stats.bookingActions = {
      booked: 0, ignored: 0, expired: 0, failed: 0, autoBooked: 0,
      uncertainBooked: 0, uncertainIgnored: 0, uncertainExpired: 0,
    };
  }
}

function recordError(stats, errorMessage, recovered = true) {
  stats.todayStats.totalErrors++;
  stats.recentErrors.push({
    timestamp: new Date().toISOString(),
    message: errorMessage,
    recovered,
  });
  while (stats.recentErrors.length > 20) stats.recentErrors.shift();
}

// ============================================================================
// JOB CARD DOM/SCREENSHOT CAPTURE
// ============================================================================

async function captureJobCardDOM(jobBody, job, index) {
  try {
    const jobCardHTML = await jobBody.innerHTML();
    const timestamp = new Date().toISOString();
    const separator = '\n\n' + '='.repeat(80) + '\n';

    const logEntry = [
      separator,
      `JOB CARD DOM EXAMPLE - Captured: ${timestamp}`,
      `Index: ${index}`,
      `Date: ${job.date}`,
      `School: ${job.school}`,
      `Subject: ${job.position}`,
      `Teacher: ${job.teacher}`,
      `Job #: ${job.jobNumber}`,
      separator,
      '',
      jobCardHTML,
      '',
      ''
    ].join('\n');

    await fs.appendFile(JOB_CARD_DOM_LOG, logEntry, 'utf-8');

    if (VERBOSE_LOGGING) {
      logToFile(`Captured DOM for job card #${index}: ${job.position} at ${job.school}`);
    }
  } catch (error) {
    logToFile(`Failed to capture job card DOM: ${error.message}`);
  }
}

async function captureJobCardScreenshot(jobBody, job, index) {
  try {
    const timestamp = Date.now();
    const filename = `job-card-${index}-${job.date.replace(/[\/,\s]/g, '-')}-${timestamp}.png`;
    const screenshotPath = path.join(__dirname, 'debug', filename);

    await jobBody.screenshot({ path: screenshotPath });

    if (VERBOSE_LOGGING) {
      logToFile(`Captured screenshot for job card #${index}: ${filename}`);
    }
  } catch (error) {
    logToFile(`Failed to capture job card screenshot: ${error.message}`);
  }
}

// ============================================================================
// BROWSER LIFECYCLE
// ============================================================================

/**
 * Launch a fresh browser, create context, and return page.
 */
async function launchBrowser() {
  logToFile('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: {
      width: 1260 + Math.floor(Math.random() * 40),
      height: 700 + Math.floor(Math.random() * 40),
    },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Denver',
  });

  const page = await context.newPage();
  return { browser, page };
}

/**
 * Login to Frontline Education with human-like behavior.
 */
async function login(page) {
  logToFile('Navigating to login page...');
  await page.goto(process.env.FRONTLINE_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(1000, 3000);

  logToFile('Entering username...');
  await page.locator(SELECTORS.login.usernameField).click();
  await humanDelay(200, 400);
  await page.locator(SELECTORS.login.usernameField).fill('');
  await page.locator(SELECTORS.login.usernameField).type(
    process.env.FRONTLINE_USERNAME,
    { delay: Math.floor(Math.random() * 80) + 80 }
  );

  await humanDelay(300, 800);

  logToFile('Entering password...');
  await page.locator(SELECTORS.login.passwordField).click();
  await humanDelay(200, 400);
  await page.locator(SELECTORS.login.passwordField).fill('');
  await page.locator(SELECTORS.login.passwordField).type(
    process.env.FRONTLINE_PASSWORD,
    { delay: Math.floor(Math.random() * 80) + 80 }
  );

  await humanDelay(200, 600);

  logToFile('Clicking sign in button...');
  await page.locator(SELECTORS.login.submitButton).click();

  await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await humanDelay(1000, 3000);

  // Handle "Important Notifications" popup if it appears
  try {
    const popup = page.locator(SELECTORS.popup.dialog);
    const isPopupVisible = await popup.isVisible({ timeout: 3000 });

    if (isPopupVisible) {
      logToFile('Dismissing notification popup...');
      await humanDelay(500, 1000);
      await page.locator(SELECTORS.popup.dismissButton).click();
      await humanDelay(500, 1000);
    }
  } catch (error) {
    logToFile('No popup to dismiss');
  }

  // Wait for all post-login redirects to fully settle
  // (Frontline redirects through /connect/authorize → /Login/Signin → /Substitute/Home)
  try {
    await page.waitForLoadState('load', { timeout: 30000 });
  } catch {
    // Timeout on full load is OK — domcontentloaded is sufficient
  }
  await humanDelay(1000, 2000);

  logToFile('Login complete');
}

/**
 * Navigate to Available Jobs tab.
 * Handles two page layouts:
 *   1. "Full View" — has #availableJobsTab (normal after fresh login)
 *   2. "Searching for Jobs" — different layout after re-login, needs to click
 *      "Click Here to return to the Full View" link first
 */
async function navigateToAvailableJobs(page) {
  logToFile('Navigating to Available Jobs tab...');

  // Try to find the tab directly (Full View layout)
  try {
    await page.waitForSelector(SELECTORS.navigation.availableJobsTab, { timeout: 5000 });
  } catch {
    // Tab not found — we might be on the "Searching for Jobs" layout
    // Look for the "Full View" link in the yellow banner
    logToFile('Available Jobs tab not found. Checking for "Full View" link...');
    try {
      const fullViewLink = page.locator('text=Click Here').first();
      const isVisible = await fullViewLink.isVisible({ timeout: 3000 });
      if (isVisible) {
        logToFile('Clicking "Full View" link to switch layouts...');
        await fullViewLink.click();
        await humanDelay(1000, 2000);
        await page.waitForSelector(SELECTORS.navigation.availableJobsTab, { timeout: 30000 });
      } else {
        throw new Error('Full View link not visible');
      }
    } catch (fallbackError) {
      // Last resort: navigate to home page via sidebar
      logToFile('Trying sidebar Available Jobs link...');
      const sidebarLink = page.locator('a:has-text("Available Jobs")').first();
      await sidebarLink.click();
      await humanDelay(1000, 2000);
      await page.waitForSelector(SELECTORS.navigation.availableJobsTab, { timeout: 30000 });
    }
  }

  await humanDelay(500, 1000);
  await page.locator(SELECTORS.navigation.availableJobsTab).click();
  await humanDelay(500, 1000);

  await page.waitForSelector(SELECTORS.navigation.availableJobsPanel, { timeout: 30000 });
  await humanDelay(1000, 2000);

  logToFile('Available Jobs tab loaded');
}

// ============================================================================
// SESSION HEALTH CHECK
// ============================================================================

/**
 * Refresh the Available Jobs page and detect session expiry.
 *
 * Uses 'commit' waitUntil (first response byte) instead of 'domcontentloaded'
 * to avoid 30s hangs when Frontline's server is slow. Falls back to page.goto()
 * if reload fails, which often works when reload doesn't.
 *
 * @returns {boolean} true if session expired (needs re-login)
 */
async function refreshPage(page) {
  const currentPageUrl = page.url();

  try {
    // 'commit' = wait for first response byte only (fast, avoids DOM parsing hangs)
    await page.reload({ waitUntil: 'commit', timeout: 15000 });
  } catch (reloadError) {
    // Reload failed — try navigating to the same URL as fallback
    if (VERBOSE_LOGGING) logToFile(`Reload failed (${reloadError.message.split('\n')[0]}), trying goto fallback...`);
    try {
      await page.goto(currentPageUrl, { waitUntil: 'commit', timeout: 15000 });
    } catch (gotoError) {
      // Both failed — throw to trigger error recovery in the main loop
      throw new Error(`Page refresh failed: ${gotoError.message.split('\n')[0]}`);
    }
  }

  // Wait for the page content to actually be usable
  try {
    await page.waitForSelector(SELECTORS.navigation.availableJobsPanel, { timeout: 15000 });
  } catch {
    // Panel not loaded — could be session expiry or slow page; check URL
  }

  await humanDelay(300, 600);

  const newUrl = page.url();

  // Detect session expiry: URL redirected to login page
  if (newUrl.includes('/login') ||
      newUrl.includes('/Account/Login') ||
      newUrl.includes('/connect/authorize') ||
      newUrl.includes('ReturnUrl=')) {
    return true; // Session expired
  }

  // Sanity check: Available Jobs tab should be present
  try {
    await page.waitForSelector(SELECTORS.navigation.availableJobsTab, { timeout: 5000 });
  } catch {
    return true; // Tab not found — likely session issue
  }

  return false;
}

// ============================================================================
// JOB SCRAPING
// ============================================================================

/**
 * Scrape all jobs from the Available Jobs page.
 * @returns {Array} Array of { job, jobBody, index } objects
 */
async function scrapeJobs(page) {
  // Check if there are no jobs available
  try {
    const noDataRow = page.locator(SELECTORS.jobs.noDataRow);
    const noDataVisible = await noDataRow.isVisible({ timeout: 1000 });

    if (noDataVisible) {
      return [];
    }
  } catch (error) {
    // No "no data" row found — proceed with scraping
  }

  const jobBodies = await page.locator(SELECTORS.jobs.jobBodies).all();
  const jobs = [];

  for (let i = 0; i < jobBodies.length; i++) {
    const jobBody = jobBodies[i];

    try {
      const summaryRow = jobBody.locator(SELECTORS.jobs.summary.row);
      const firstDetailRow = jobBody.locator(SELECTORS.jobs.detail.row).first();

      const classAttr = await jobBody.getAttribute('class') || '';
      const isMultiDay = classAttr.includes('multiday');

      const job = {
        teacher: await summaryRow.locator(SELECTORS.jobs.summary.teacherName).textContent().catch(() => 'N/A'),
        position: await summaryRow.locator(SELECTORS.jobs.summary.position).textContent().catch(() => 'N/A'),
        reportTo: await summaryRow.locator(SELECTORS.jobs.summary.reportTo).textContent().catch(() => 'N/A'),
        jobNumber: await summaryRow.locator(SELECTORS.jobs.summary.confirmationNumber).textContent().catch(() => 'N/A'),

        date: await firstDetailRow.locator(SELECTORS.jobs.detail.date).textContent().catch(() => 'N/A'),
        startTime: await firstDetailRow.locator(SELECTORS.jobs.detail.startTime).textContent().catch(() => 'N/A'),
        endTime: await firstDetailRow.locator(SELECTORS.jobs.detail.endTime).textContent().catch(() => 'N/A'),
        duration: await firstDetailRow.locator(SELECTORS.jobs.detail.duration).textContent().catch(() => 'N/A'),
        school: await firstDetailRow.locator(SELECTORS.jobs.detail.location).textContent().catch(() => 'N/A'),

        isMultiDay,
        days: [],
      };

      if (isMultiDay) {
        const allDetailRows = await jobBody.locator(SELECTORS.jobs.detail.allRows).all();
        for (const row of allDetailRows) {
          const day = {
            date: await row.locator(SELECTORS.jobs.detail.date).textContent().catch(() => 'N/A'),
            startTime: await row.locator(SELECTORS.jobs.detail.startTime).textContent().catch(() => 'N/A'),
            endTime: await row.locator(SELECTORS.jobs.detail.endTime).textContent().catch(() => 'N/A'),
            duration: await row.locator(SELECTORS.jobs.detail.duration).textContent().catch(() => 'N/A'),
            location: await row.locator(SELECTORS.jobs.detail.location).textContent().catch(() => 'N/A'),
          };
          Object.keys(day).forEach(key => {
            if (typeof day[key] === 'string') day[key] = day[key].trim();
          });
          job.days.push(day);
        }
        if (VERBOSE_LOGGING) logToFile(`  Multi-day job detected: ${job.days.length} days`);
      }

      Object.keys(job).forEach(key => {
        if (typeof job[key] === 'string') {
          job[key] = job[key].trim();
        }
      });

      jobs.push({ job, jobBody, index: i });

    } catch (error) {
      logToFile(`Error scraping job at index ${i}: ${error.message}`);
    }
  }

  return jobs;
}

// ============================================================================
// AUTO-BOOKING: Callback Processing + Job Booking
// ============================================================================

/**
 * Process Telegram callback queries (Book/Ignore button presses).
 * Updates notified jobs state and answers the callback.
 */
async function processCallbacks(notifiedJobs) {
  const { queries, newOffset } = await pollCallbackQueries(lastUpdateOffset);
  lastUpdateOffset = newOffset;

  for (const query of queries) {
    const data = query.data || '';
    const [action, jobHash] = data.split(':');

    if (!jobHash || !notifiedJobs[jobHash]) {
      await answerCallback(query.id, 'Job not found or expired');
      continue;
    }

    const entry = notifiedJobs[jobHash];

    if (action === 'book') {
      if (entry.status !== 'notified') {
        await answerCallback(query.id, `Already ${entry.status}`);
        continue;
      }
      entry.status = 'book_requested';
      logToFile(`Book requested via Telegram: ${entry.jobData?.position} at ${entry.jobData?.school}`);
      await answerCallback(query.id, 'Booking...');

    } else if (action === 'ignore') {
      if (entry.status !== 'notified') {
        await answerCallback(query.id, `Already ${entry.status}`);
        continue;
      }
      entry.status = 'ignored';
      logToFile(`Ignored via Telegram: ${entry.jobData?.position} at ${entry.jobData?.school}`);
      await answerCallback(query.id, 'Ignored');

      // Track booking action
      if (scraperStats?.bookingActions) {
        scraperStats.bookingActions.ignored++;
        if (entry.uncertain) scraperStats.bookingActions.uncertainIgnored++;
      }

      // Edit message to remove keyboard
      if (entry.telegramMessageId && entry.jobData) {
        await updateMessageAfterAction(entry.telegramMessageId, entry.jobData, entry.uncertain, 'ignored');
      }
    }
  }

  return notifiedJobs;
}

/**
 * Execute pending bookings (jobs with status 'book_requested').
 * Finds the job on the page, clicks Accept, handles confirmation popup.
 */
async function executePendingBookings(page, notifiedJobs) {
  for (const entry of Object.values(notifiedJobs)) {
    if (entry.status !== 'book_requested') continue;

    entry.status = 'booking';
    const jobData = entry.jobData;
    const msgOptions = entry.autoBooked
      ? { autoBooked: true, daysAhead: getJobDaysAhead(jobData) }
      : {};
    logToFile(`Executing booking: ${jobData?.position} at ${jobData?.school} (Job #${jobData?.jobNumber})`);

    try {
      const result = await bookJobOnPage(page, jobData);

      if (result.success) {
        entry.status = 'booked';
        logToFile(`BOOKED: ${jobData?.position} at ${jobData?.school}`);
        if (entry.telegramMessageId && jobData) {
          await updateMessageAfterAction(entry.telegramMessageId, jobData, entry.uncertain, 'booked', msgOptions);
        }
        if (scraperStats?.bookingActions) {
          scraperStats.bookingActions.booked++;
          if (entry.autoBooked) scraperStats.bookingActions.autoBooked++;
          if (entry.uncertain) scraperStats.bookingActions.uncertainBooked++;
        }
      } else {
        entry.status = 'failed';
        logToFile(`BOOKING FAILED (${result.reason}): ${jobData?.position} at ${jobData?.school}`);
        if (entry.telegramMessageId && jobData) {
          await updateMessageAfterAction(entry.telegramMessageId, jobData, entry.uncertain, result.reason === 'taken' ? 'taken' : 'error', msgOptions);
        }
        if (scraperStats?.bookingActions) {
          scraperStats.bookingActions.failed++;
        }
      }
    } catch (bookError) {
      entry.status = 'failed';
      logToFile(`Booking error: ${bookError.message}`);
      if (entry.telegramMessageId && jobData) {
        await updateMessageAfterAction(entry.telegramMessageId, jobData, entry.uncertain, 'error', msgOptions);
      }
      if (scraperStats?.bookingActions) {
        scraperStats.bookingActions.failed++;
      }
    }
  }

  return notifiedJobs;
}

/**
 * Book a job on the Frontline page by finding it and clicking Accept.
 * @returns {{ success: boolean, reason: 'booked'|'taken'|'error', message: string }}
 */
async function bookJobOnPage(page, jobData) {
  if (!jobData?.jobNumber) {
    return { success: false, reason: 'error', message: 'No job number' };
  }

  // Refresh to get current page state
  await page.reload({ waitUntil: 'commit', timeout: 15000 });
  await page.waitForSelector(SELECTORS.navigation.availableJobsPanel, { timeout: 15000 });
  await humanDelay(500, 1000);

  // Find job by confirmation number
  const jobBodies = await page.locator(SELECTORS.jobs.jobBodies).all();

  for (const jobBody of jobBodies) {
    const confNum = await jobBody.locator('tr.summary .confNum').textContent().catch(() => '');

    if (confNum.trim() !== jobData.jobNumber) continue;

    // Found the job — handle multi-day expansion
    const classAttr = await jobBody.getAttribute('class') || '';
    const isMultiDay = classAttr.includes('multiday');

    if (isMultiDay) {
      logToFile('Multi-day job — expanding details...');
      await jobBody.locator(SELECTORS.jobs.actions.seeDetailsButton).click();
      await humanDelay(500, 1000);
    }

    // Click Accept button
    logToFile('Clicking Accept button...');
    await jobBody.locator(SELECTORS.jobs.actions.acceptButton).click();
    await humanDelay(1000, 2000);

    // Wait for confirmation popup (jQuery UI dialog with "Notes" title)
    try {
      await page.waitForSelector(SELECTORS.jobs.bookingConfirmation.dialog, { timeout: 5000 });
      logToFile('Confirmation popup appeared. Clicking Accept to confirm...');

      // Screenshot the confirmation popup for records
      await page.screenshot({ path: path.join(__dirname, 'debug', `booking-confirm-${Date.now()}.png`) });

      // Click the "Accept" button (last button in button set)
      await page.locator(SELECTORS.jobs.bookingConfirmation.confirmButton).click();
      await humanDelay(1000, 2000);

      // Screenshot after confirmation
      await page.screenshot({ path: path.join(__dirname, 'debug', `booking-result-${Date.now()}.png`) });

      logToFile('Booking confirmed!');
      return { success: true, reason: 'booked', message: 'Booking confirmed' };

    } catch (popupError) {
      logToFile(`Confirmation popup not found: ${popupError.message}`);
      await page.screenshot({ path: path.join(__dirname, 'debug', `booking-no-popup-${Date.now()}.png`) });
      return { success: false, reason: 'error', message: 'Confirmation popup did not appear' };
    }
  }

  logToFile(`Job #${jobData.jobNumber} not found on page — likely taken by someone else`);
  return { success: false, reason: 'taken', message: 'Job no longer available — someone else got it' };
}

/**
 * Expire old notifications (remove keyboard after NOTIFICATION_EXPIRY_MS).
 */
async function expireOldNotifications(notifiedJobs) {
  const now = Date.now();

  for (const entry of Object.values(notifiedJobs)) {
    if (entry.status === 'notified' && entry.expiresAt && now > entry.expiresAt) {
      entry.status = 'expired';
      logToFile(`Expired notification: ${entry.jobData?.position} at ${entry.jobData?.school}`);

      if (entry.telegramMessageId && entry.jobData) {
        await updateMessageAfterAction(entry.telegramMessageId, entry.jobData, entry.uncertain, 'expired');
      }

      if (scraperStats?.bookingActions) {
        scraperStats.bookingActions.expired++;
        if (entry.uncertain) scraperStats.bookingActions.uncertainExpired++;
      }
    }
  }

  return notifiedJobs;
}

/**
 * Recover from crash: any entries stuck in 'booking' state → mark as 'failed'.
 */
function recoverStuckBookings(notifiedJobs) {
  for (const entry of Object.values(notifiedJobs)) {
    if (entry.status === 'booking') {
      entry.status = 'failed';
      logToFile(`Recovered stuck booking: ${entry.jobData?.position} at ${entry.jobData?.school}`);
    }
  }
  return notifiedJobs;
}

// ============================================================================
// SINGLE SCRAPE-FILTER-NOTIFY CYCLE
// ============================================================================

/**
 * One cycle of: poll callbacks → execute bookings → expire → scrape → filter → notify.
 * @returns {{ jobsSeen, jobsMatched, jobsNotified }} cycle result
 */
async function performScrapeFilterNotify(page) {
  // --- Step 1: Process Telegram callbacks (Book/Ignore button presses) ---
  let notifiedJobs = await loadNotifiedJobs();

  if (AUTO_BOOKING_ENABLED) {
    notifiedJobs = await processCallbacks(notifiedJobs);
    notifiedJobs = await executePendingBookings(page, notifiedJobs);
    notifiedJobs = await expireOldNotifications(notifiedJobs);
    await saveNotifiedJobs(notifiedJobs);

    // Re-navigate to Available Jobs after any booking attempts
    // (booking may have changed the page state)
    const hasBookingAttempts = Object.values(notifiedJobs).some(e => e.status === 'booked' || e.status === 'failed');
    if (hasBookingAttempts) {
      try {
        await page.reload({ waitUntil: 'commit', timeout: 15000 });
        await humanDelay(500, 1000);
      } catch (e) {
        logToFile(`Page reload after booking failed: ${e.message}`);
      }
    }
  }

  // --- Step 2: Scrape jobs ---
  const jobsData = await scrapeJobs(page);

  // Throttled screenshot: only when useful
  cycleCount++;
  const shouldScreenshot = (
    cycleCount === 1 ||
    cycleCount % SCREENSHOT_EVERY_N_CYCLES === 0 ||
    jobsData.length !== previousJobCount
  );

  if (shouldScreenshot) {
    const timestamp = Date.now();
    await page.screenshot({
      path: path.join(__dirname, 'debug', `02-available-jobs-${jobsData.length}jobs-${timestamp}.png`)
    });
  }
  previousJobCount = jobsData.length;

  // --- Step 3: Filter jobs ---
  const matchedJobs = [];
  for (const { job, jobBody, index } of jobsData) {
    const filterResult = filterJob(job);

    if (filterResult.match) {
      matchedJobs.push({ job, jobBody, index, filterResult });
      if (VERBOSE_LOGGING) logToFile(`  Matched: ${job.position} at ${job.school}`);

      // Capture DOM and screenshot for matched jobs
      await captureJobCardDOM(jobBody, job, index);
      await captureJobCardScreenshot(jobBody, job, index);
    } else if (VERBOSE_LOGGING) {
      logToFile(`  Rejected: ${job.position} at ${job.school} - ${filterResult.reason}`);
    }
  }

  // Count uncertain matches
  const uncertainMatched = matchedJobs.filter(m => m.filterResult.uncertain).length;

  // --- Step 4: Send notifications for new matches ---
  let newJobsNotified = 0;
  let uncertainNotified = 0;
  let autoBooked = 0;

  for (const { job, filterResult } of matchedJobs) {
    const jobHash = createJobHash(job);

    if (!notifiedJobs[jobHash]) {
      logToFile(`New job: ${job.position} at ${job.school}`);

      try {
        if (AUTO_BOOKING_ENABLED && shouldAutoBook(job, filterResult.uncertain)) {
          // AUTO-BOOK: Certain match, 3+ days away — book immediately, no human confirmation
          const daysAhead = getJobDaysAhead(job);
          logToFile(`AUTO-BOOKING: ${job.position} at ${job.school} (${daysAhead} days away)`);
          const messageId = await sendAutoBookNotification(job, daysAhead);
          notifiedJobs[jobHash] = {
            status: 'book_requested',
            timestamp: Date.now(),
            expiresAt: null, // No expiry — we're booking immediately
            telegramMessageId: messageId,
            jobData: job,
            uncertain: false,
            autoBooked: true,
          };
          autoBooked++;
        } else if (AUTO_BOOKING_ENABLED) {
          // MANUAL CONFIRMATION: Uncertain match or job too soon — send Book/Ignore buttons
          const messageId = await sendJobNotificationWithKeyboard(job, filterResult.uncertain, jobHash);
          notifiedJobs[jobHash] = {
            status: 'notified',
            timestamp: Date.now(),
            expiresAt: Date.now() + NOTIFICATION_EXPIRY_MS,
            telegramMessageId: messageId,
            jobData: job,
            uncertain: filterResult.uncertain,
          };
        } else {
          // Fallback: plain notification (no booking buttons)
          await sendJobNotification(job, filterResult.uncertain);
          notifiedJobs[jobHash] = {
            status: 'notified',
            timestamp: Date.now(),
            expiresAt: null,
            telegramMessageId: null,
            jobData: job,
            uncertain: filterResult.uncertain,
          };
        }
        newJobsNotified++;
        if (filterResult.uncertain) uncertainNotified++;

        if (newJobsNotified > 1) {
          await humanDelay(1000, 2000); // Rate limiting
        }
      } catch (error) {
        logToFile(`Failed to send notification: ${error.message}`);
      }
    }
  }

  // Execute auto-bookings immediately (same cycle — don't wait 30s)
  if (autoBooked > 0) {
    logToFile(`Executing ${autoBooked} auto-booking(s) immediately...`);
    notifiedJobs = await executePendingBookings(page, notifiedJobs);
  }

  // Summary notification
  if (newJobsNotified > 0) {
    try {
      await sendSummaryNotification(jobsData.length, matchedJobs.length, newJobsNotified, uncertainNotified);
    } catch (error) {
      logToFile(`Failed to send summary: ${error.message}`);
    }
  }

  // Clean old entries and save
  notifiedJobs = cleanOldNotifications(notifiedJobs);
  await saveNotifiedJobs(notifiedJobs);

  // Periodic cleanup (throttled)
  if (cycleCount % CLEANUP_EVERY_N_CYCLES === 0) {
    await cleanupOldDebugFiles(DEBUG_FILE_RETENTION_DAYS);
  }

  // Periodic log rotation (throttled)
  if (cycleCount % LOG_ROTATE_EVERY_N_CYCLES === 0) {
    await rotateLogIfNeeded();
  }

  return {
    jobsSeen: jobsData.length,
    jobsMatched: matchedJobs.length,
    jobsNotified: newJobsNotified,
    uncertainMatched,
    uncertainNotified,
  };
}

// ============================================================================
// ERROR SCREENSHOT HELPER
// ============================================================================

async function captureErrorScreenshot(page) {
  try {
    const timestamp = Date.now();
    await page.screenshot({ path: path.join(__dirname, 'debug', `error-${timestamp}.png`) });
    logToFile(`Error screenshot saved: error-${timestamp}.png`);
  } catch (screenshotError) {
    logToFile(`Failed to capture error screenshot: ${screenshotError.message}`);
  }
}

// ============================================================================
// MAIN DAEMON LOOP
// ============================================================================

async function main() {
  setupSignalHandlers();
  await ensureDirectories();

  logToFile('=== Scraper daemon starting ===');

  // Recover any jobs stuck in 'booking' state from a previous crash
  let notifiedJobs = await loadNotifiedJobs();
  notifiedJobs = recoverStuckBookings(notifiedJobs);
  await saveNotifiedJobs(notifiedJobs);

  // Load or initialize stats
  const existingStats = await loadScraperStats();
  scraperStats = initStats(existingStats);

  // Outer loop: browser lifecycle (restarts browser every 2 hours or on fatal error)
  while (!shutdownRequested) {
    let browser = null;
    let page = null;
    let consecutiveErrors = 0;

    try {
      // Launch browser and login
      const result = await launchBrowser();
      browser = result.browser;
      page = result.page;

      scraperStats.currentStatus.browserHealthy = true;

      await login(page);
      await navigateToAvailableJobs(page);

      const browserStartTime = Date.now();
      cycleCount = 0; // Reset cycle count for new browser session

      logToFile('Browser session ready. Starting scrape loop...');

      // Inner loop: scrape cycles
      while (!shutdownRequested) {
        // Check if browser restart needed (every 2 hours)
        if (Date.now() - browserStartTime > BROWSER_RESTART_INTERVAL_MS) {
          logToFile('Browser restart interval reached (2 hours). Restarting...');
          break;
        }

        // Check operating hours
        if (!isOperatingHours()) {
          if (VERBOSE_LOGGING) logToFile('Outside operating hours. Sleeping...');
          await writeHeartbeat({ status: 'sleeping', reason: 'off-hours' });
          await sleep(OFF_HOURS_SLEEP_MS);
          continue;
        }

        const cycleStart = Date.now();

        try {
          // Refresh page and check session health
          const needsRelogin = await refreshPage(page);

          if (needsRelogin) {
            logToFile('Session expired. Re-logging in...');
            await login(page);
            await navigateToAvailableJobs(page);
          }

          // Run one scrape-filter-notify cycle
          const result = await performScrapeFilterNotify(page);
          consecutiveErrors = 0;

          const durationMs = Date.now() - cycleStart;

          // Record stats
          recordCheck(scraperStats, { ...result, durationMs });
          await writeScraperStats(scraperStats);
          await writeHeartbeat({
            status: 'running',
            lastCycle: { ...result, durationMs },
          });

          // Concise cycle log
          logToFile(`Cycle: ${result.jobsSeen} seen, ${result.jobsMatched} matched, ${result.jobsNotified} new (${durationMs}ms)`);

        } catch (scrapeError) {
          consecutiveErrors++;
          logToFile(`Scrape error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${scrapeError.message}`);

          recordError(scraperStats, scrapeError.message, consecutiveErrors < MAX_CONSECUTIVE_ERRORS);
          await writeScraperStats(scraperStats);

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            logToFile('Too many consecutive errors. Restarting browser...');
            await sendErrorAlert(`Restarting browser after ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${scrapeError.message}`).catch(() => {});
            break;
          }

          await captureErrorScreenshot(page);
        }

        // Wait between cycles
        await sleep(SCRAPE_INTERVAL_MS);
      }

    } catch (outerError) {
      logToFile(`Browser lifecycle error: ${outerError.message}`);
      scraperStats.currentStatus.browserHealthy = false;
      recordError(scraperStats, outerError.message, true);
      await writeScraperStats(scraperStats);
      await sendErrorAlert(outerError.message).catch(() => {});
    } finally {
      if (browser) {
        try { await browser.close(); } catch (e) { /* ignore */ }
        logToFile('Browser closed.');
      }
    }

    // Pause before restarting browser (prevents tight restart loop)
    if (!shutdownRequested) {
      logToFile(`Pausing ${BROWSER_RESTART_PAUSE_MS / 1000}s before browser restart...`);
      await sleep(BROWSER_RESTART_PAUSE_MS);
    }
  }

  // Clean shutdown
  scraperStats.currentStatus.isRunning = false;
  await writeScraperStats(scraperStats);
  logToFile('=== Scraper daemon shut down gracefully ===');
  process.exit(0);
}

// Run the daemon
main();
