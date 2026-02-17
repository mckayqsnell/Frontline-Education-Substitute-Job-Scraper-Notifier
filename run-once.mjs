#!/usr/bin/env node
/**
 * Run-Once Wrapper for Manual Testing
 *
 * This script runs the scraper once manually for testing purposes.
 * Unlike scheduled runs, this:
 * - Ignores operating hours check (runs anytime)
 * - Shows all console output
 * - Useful for debugging and testing changes
 *
 * Run with: pnpm run scrape
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { SELECTORS } from './selectors.mjs';
import { filterJob } from './filters.mjs';
import { sendJobNotification, sendErrorAlert, sendSummaryNotification } from './notify.mjs';
import {
  humanDelay,
  createJobHash,
  ensureDirectories,
  cleanupOldDebugFiles,
} from './utils.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const NOTIFIED_JOBS_FILE = path.join(__dirname, 'data', 'notified-jobs.json');
const JOB_CARD_DOM_LOG = path.join(__dirname, 'logs', 'job-card-dom-examples.html');
const GLOBAL_TIMEOUT = 120000; // 2 minutes
const DEBUG_FILE_RETENTION_DAYS = 3; // Keep debug screenshots for 3 days

// Global timeout to prevent hanging
const globalTimeout = setTimeout(() => {
  console.error('❌ Global timeout reached (2 minutes). Killing process.');
  process.exit(1);
}, GLOBAL_TIMEOUT);

// Custom logging function that both logs to console and file
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  // Also log to file
  const logFile = path.join(__dirname, 'logs', 'scraper.log');
  fs.appendFile(logFile, logMessage + '\n', 'utf-8').catch(() => {});
}

async function loadNotifiedJobs() {
  try {
    const data = await fs.readFile(NOTIFIED_JOBS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveNotifiedJobs(notifiedJobs) {
  await fs.writeFile(NOTIFIED_JOBS_FILE, JSON.stringify(notifiedJobs, null, 2), 'utf-8');
}

function cleanOldNotifications(notifiedJobs, maxAgeDays = 7) {
  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  const cleaned = {};

  for (const [hash, timestamp] of Object.entries(notifiedJobs)) {
    if (timestamp > cutoffTime) {
      cleaned[hash] = timestamp;
    }
  }

  const removedCount = Object.keys(notifiedJobs).length - Object.keys(cleaned).length;
  if (removedCount > 0) {
    log(`Cleaned up ${removedCount} old job notifications (older than ${maxAgeDays} days)`);
  }

  return cleaned;
}

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
    log(`📝 Captured DOM for job card #${index}: ${job.position} at ${job.school}`);
  } catch (error) {
    log(`Failed to capture job card DOM: ${error.message}`);
  }
}

async function captureJobCardScreenshot(jobBody, job, index) {
  try {
    const timestamp = Date.now();
    const filename = `job-card-${index}-${job.date.replace(/[\/,\s]/g, '-')}-${timestamp}.png`;
    const screenshotPath = path.join(__dirname, 'debug', filename);

    await jobBody.screenshot({ path: screenshotPath });
    log(`📸 Captured screenshot for job card #${index}: ${filename}`);
  } catch (error) {
    log(`Failed to capture job card screenshot: ${error.message}`);
  }
}

async function login(page) {
  log('Navigating to login page...');
  await page.goto(process.env.FRONTLINE_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(1000, 3000);

  log('Entering username...');
  await page.locator(SELECTORS.login.usernameField).click();
  await humanDelay(200, 400);
  await page.locator(SELECTORS.login.usernameField).fill('');
  await page.locator(SELECTORS.login.usernameField).type(
    process.env.FRONTLINE_USERNAME,
    { delay: Math.floor(Math.random() * 80) + 80 }
  );

  await humanDelay(300, 800);

  log('Entering password...');
  await page.locator(SELECTORS.login.passwordField).click();
  await humanDelay(200, 400);
  await page.locator(SELECTORS.login.passwordField).fill('');
  await page.locator(SELECTORS.login.passwordField).type(
    process.env.FRONTLINE_PASSWORD,
    { delay: Math.floor(Math.random() * 80) + 80 }
  );

  await humanDelay(200, 600);

  log('Clicking sign in button...');
  await page.locator(SELECTORS.login.submitButton).click();

  await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await humanDelay(1000, 3000);

  try {
    const popup = page.locator(SELECTORS.popup.dialog);
    const isPopupVisible = await popup.isVisible({ timeout: 3000 });

    if (isPopupVisible) {
      log('Dismissing notification popup...');
      await humanDelay(500, 1000);
      await page.locator(SELECTORS.popup.dismissButton).click();
      await humanDelay(500, 1000);
    }
  } catch (error) {
    log('No popup to dismiss');
  }

  const timestamp = Date.now();
  await page.screenshot({ path: path.join(__dirname, 'debug', `01-after-login-${timestamp}.png`) });
  log('Login complete - screenshot saved');
}

async function navigateToAvailableJobs(page) {
  log('Navigating to Available Jobs tab...');

  await page.waitForSelector(SELECTORS.navigation.availableJobsTab, { timeout: 10000 });
  await humanDelay(500, 1000);

  await page.locator(SELECTORS.navigation.availableJobsTab).click();
  await humanDelay(500, 1000);

  await page.waitForSelector(SELECTORS.navigation.availableJobsPanel, { timeout: 10000 });
  await humanDelay(1000, 2000);

  log('Available Jobs tab loaded');
}

async function scrapeJobs(page) {
  log('Scraping jobs...');

  try {
    const noDataRow = page.locator(SELECTORS.jobs.noDataRow);
    const noDataVisible = await noDataRow.isVisible({ timeout: 3000 });

    if (noDataVisible) {
      log('No available jobs at this time');
      return [];
    }
  } catch (error) {
    // No "no data" row found - proceed with scraping
  }

  const jobBodies = await page.locator(SELECTORS.jobs.jobBodies).all();
  log(`Found ${jobBodies.length} job elements`);

  const jobs = [];

  for (let i = 0; i < jobBodies.length; i++) {
    const jobBody = jobBodies[i];

    try {
      const summaryRow = jobBody.locator(SELECTORS.jobs.summary.row);
      const firstDetailRow = jobBody.locator(SELECTORS.jobs.detail.row).first();

      // Check if this is a multi-day job (tbody has class "multiday")
      const classAttr = await jobBody.getAttribute('class') || '';
      const isMultiDay = classAttr.includes('multiday');

      const job = {
        teacher: await summaryRow.locator(SELECTORS.jobs.summary.teacherName).textContent().catch(() => 'N/A'),
        position: await summaryRow.locator(SELECTORS.jobs.summary.position).textContent().catch(() => 'N/A'),
        reportTo: await summaryRow.locator(SELECTORS.jobs.summary.reportTo).textContent().catch(() => 'N/A'),
        jobNumber: await summaryRow.locator(SELECTORS.jobs.summary.confirmationNumber).textContent().catch(() => 'N/A'),

        // Primary date/time/location from first detail row
        date: await firstDetailRow.locator(SELECTORS.jobs.detail.date).textContent().catch(() => 'N/A'),
        startTime: await firstDetailRow.locator(SELECTORS.jobs.detail.startTime).textContent().catch(() => 'N/A'),
        endTime: await firstDetailRow.locator(SELECTORS.jobs.detail.endTime).textContent().catch(() => 'N/A'),
        duration: await firstDetailRow.locator(SELECTORS.jobs.detail.duration).textContent().catch(() => 'N/A'),
        school: await firstDetailRow.locator(SELECTORS.jobs.detail.location).textContent().catch(() => 'N/A'),

        isMultiDay,
        days: [],
      };

      // For multi-day jobs, scrape all detail rows to get each day's info
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
        log(`  Multi-day job detected: ${job.days.length} days`);
      }

      // Clean up whitespace on main fields
      Object.keys(job).forEach(key => {
        if (typeof job[key] === 'string') {
          job[key] = job[key].trim();
        }
      });

      jobs.push({ job, jobBody, index: i });

    } catch (error) {
      log(`Error scraping job at index ${i}: ${error.message}`);
    }
  }

  log(`Successfully scraped ${jobs.length} jobs`);
  return jobs;
}

async function main() {
  let browser = null;

  try {
    log('=== Starting manual scraper run ===');
    log('⚠️  NOTE: This run ignores operating hours - runs anytime');

    await ensureDirectories();

    let notifiedJobs = await loadNotifiedJobs();
    log(`Loaded ${Object.keys(notifiedJobs).length} previously notified jobs`);

    log('Launching browser...');
    browser = await chromium.launch({
      headless: false, // Set to false to see the browser in action
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

    await login(page);
    await navigateToAvailableJobs(page);
    const jobsData = await scrapeJobs(page);

    // Take screenshot of available jobs page with job count in filename
    const timestamp = Date.now();
    const jobCount = jobsData.length;
    await page.screenshot({
      path: path.join(__dirname, 'debug', `02-available-jobs-${jobCount}jobs-${timestamp}.png`)
    });
    log(`Available Jobs screenshot saved: ${jobCount} jobs found`);

    const matchedJobs = [];
    for (const { job, jobBody, index } of jobsData) {
      const filterResult = filterJob(job);

      if (filterResult.match) {
        matchedJobs.push({ job, jobBody, index, filterResult });
        log(`✓ Matched: ${job.position} at ${job.school} - ${filterResult.reason}`);

        await captureJobCardDOM(jobBody, job, index);
        await captureJobCardScreenshot(jobBody, job, index);

      } else {
        log(`✗ Rejected: ${job.position} at ${job.school} - ${filterResult.reason}`);
      }
    }

    log(`Found ${matchedJobs.length} matching jobs out of ${jobsData.length} total`);

    let newJobsNotified = 0;
    for (const { job, jobBody, filterResult } of matchedJobs) {
      const jobHash = createJobHash(job);

      if (!notifiedJobs[jobHash]) {
        log(`🔔 New job to notify: ${job.position} at ${job.school}`);

        try {
          await sendJobNotification(job, filterResult.uncertain);
          notifiedJobs[jobHash] = Date.now();
          newJobsNotified++;

          if (newJobsNotified < matchedJobs.length) {
            await humanDelay(1000, 2000);
          }
        } catch (error) {
          log(`Failed to send notification: ${error.message}`);
        }
      } else {
        log(`Already notified about: ${job.position} at ${job.school}`);
      }
    }

    if (newJobsNotified > 0) {
      try {
        await sendSummaryNotification(jobsData.length, matchedJobs.length, newJobsNotified);
      } catch (error) {
        log(`Failed to send summary: ${error.message}`);
      }
    }

    notifiedJobs = cleanOldNotifications(notifiedJobs);
    await saveNotifiedJobs(notifiedJobs);

    // Clean up old debug files (screenshots and HTML)
    await cleanupOldDebugFiles(DEBUG_FILE_RETENTION_DAYS);

    log(`=== Scraper run complete ===`);
    log(`Total jobs: ${jobsData.length}`);
    log(`Matched jobs: ${matchedJobs.length}`);
    log(`New jobs notified: ${newJobsNotified}`);

    await browser.close();
    clearTimeout(globalTimeout);
    process.exit(0);

  } catch (error) {
    log(`❌ ERROR: ${error.message}`);
    console.error('Error:', error);

    if (browser) {
      try {
        const pages = await browser.contexts().then(c => c[0]?.pages() || []);
        if (pages.length > 0) {
          const timestamp = Date.now();
          await pages[0].screenshot({ path: path.join(__dirname, 'debug', `error-${timestamp}.png`) });
          log(`Error screenshot saved: error-${timestamp}.png`);
        }
      } catch (screenshotError) {
        log(`Failed to capture error screenshot: ${screenshotError.message}`);
      }
    }

    try {
      await sendErrorAlert(error.message);
    } catch (notifyError) {
      log(`Failed to send error notification: ${notifyError.message}`);
    }

    if (browser) {
      await browser.close();
    }
    clearTimeout(globalTimeout);
    process.exit(1);
  }
}

main();
