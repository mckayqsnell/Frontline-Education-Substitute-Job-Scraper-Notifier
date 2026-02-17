#!/usr/bin/env node
/**
 * Frontline Education Substitute Job Scraper
 *
 * Main scraper logic:
 * 1. Check operating hours (5 AM - 8 PM MT, Mon-Fri)
 * 2. Login to Frontline Education
 * 3. Navigate to Available Jobs
 * 4. Scrape all jobs
 * 5. Filter based on criteria (school level, subject, duration, blacklist)
 * 6. Send Telegram notifications for new matches
 * 7. Track notified jobs to prevent duplicates
 * 8. Capture DOM structure and screenshots of matching jobs for future auto-booking
 *
 * FUTURE ENHANCEMENT: Add automated job booking with Telegram bot confirmation
 * - Send notification with job details
 * - Wait for user response (yes/no)
 * - If yes, automatically click the accept/book button
 * - Confirm booking was successful
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
  logToFile,
  isOperatingHours,
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
const GLOBAL_TIMEOUT = 120000; // 2 minutes - kill process if it takes too long
const MAX_JOB_AGE_DAYS = 7; // Clean up notified jobs older than 7 days
const DEBUG_FILE_RETENTION_DAYS = 3; // Keep debug screenshots for 3 days (216 runs/day @ 5-min intervals = ~648 screenshots/day)

// Global timeout to prevent hanging
const globalTimeout = setTimeout(() => {
  console.error('❌ Global timeout reached (2 minutes). Killing process.');
  process.exit(1);
}, GLOBAL_TIMEOUT);

/**
 * Load the list of previously notified jobs
 * @returns {Promise<Object>} Object mapping job hashes to timestamps
 */
async function loadNotifiedJobs() {
  try {
    const data = await fs.readFile(NOTIFIED_JOBS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist yet or is invalid - return empty object
    return {};
  }
}

/**
 * Save the list of notified jobs
 * @param {Object} notifiedJobs - Object mapping job hashes to timestamps
 */
async function saveNotifiedJobs(notifiedJobs) {
  await fs.writeFile(NOTIFIED_JOBS_FILE, JSON.stringify(notifiedJobs, null, 2), 'utf-8');
}

/**
 * Clean up old entries from notified jobs (older than MAX_JOB_AGE_DAYS)
 * @param {Object} notifiedJobs - Object mapping job hashes to timestamps
 * @returns {Object} Cleaned object
 */
function cleanOldNotifications(notifiedJobs) {
  const cutoffTime = Date.now() - (MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000);
  const cleaned = {};

  for (const [hash, timestamp] of Object.entries(notifiedJobs)) {
    if (timestamp > cutoffTime) {
      cleaned[hash] = timestamp;
    }
  }

  const removedCount = Object.keys(notifiedJobs).length - Object.keys(cleaned).length;
  if (removedCount > 0) {
    logToFile(`Cleaned up ${removedCount} old job notifications (older than ${MAX_JOB_AGE_DAYS} days)`);
  }

  return cleaned;
}

/**
 * FUTURE FEATURE: Capture job card DOM structure for automated booking
 *
 * This function saves the HTML structure of a job card to help implement
 * automated booking in the future. When we're ready to add auto-booking,
 * we'll use these examples to identify the "Accept" or "Book" button selectors.
 *
 * @param {Locator} jobBody - Playwright locator for the job card tbody element
 * @param {Object} job - The job data object
 * @param {number} index - Index of this job in the list
 */
async function captureJobCardDOM(jobBody, job, index) {
  try {
    // Get the full HTML of this job card
    const jobCardHTML = await jobBody.innerHTML();

    // Create a nicely formatted log entry
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

    // Append to the job card DOM log file
    await fs.appendFile(JOB_CARD_DOM_LOG, logEntry, 'utf-8');

    logToFile(`📝 Captured DOM for job card #${index}: ${job.position} at ${job.school}`);

    // FUTURE: This is where we'll identify the booking button selector
    // Example selector to look for: 'button.accept-job', 'a.book-assignment', etc.
    // Once we have enough examples, we can add the selector to selectors.mjs
    // and implement the booking logic here

  } catch (error) {
    logToFile(`Failed to capture job card DOM: ${error.message}`);
  }
}

/**
 * FUTURE FEATURE: Take a screenshot of an individual job card
 *
 * This helps us visually see what the job cards look like when they appear,
 * making it easier to identify booking buttons and other interactive elements.
 *
 * @param {Locator} jobBody - Playwright locator for the job card tbody element
 * @param {Object} job - The job data object
 * @param {number} index - Index of this job in the list
 */
async function captureJobCardScreenshot(jobBody, job, index) {
  try {
    const timestamp = Date.now();
    const filename = `job-card-${index}-${job.date.replace(/[\/,\s]/g, '-')}-${timestamp}.png`;
    const screenshotPath = path.join(__dirname, 'debug', filename);

    await jobBody.screenshot({ path: screenshotPath });

    logToFile(`📸 Captured screenshot for job card #${index}: ${filename}`);
  } catch (error) {
    logToFile(`Failed to capture job card screenshot: ${error.message}`);
  }
}

/**
 * Login to Frontline Education with human-like behavior
 * @param {Page} page - Playwright page object
 */
async function login(page) {
  logToFile('Navigating to login page...');
  await page.goto(process.env.FRONTLINE_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(1000, 3000);

  // Type username with human-like delays
  logToFile('Entering username...');
  await page.locator(SELECTORS.login.usernameField).click();
  await humanDelay(200, 400);
  await page.locator(SELECTORS.login.usernameField).fill(''); // Clear first
  await page.locator(SELECTORS.login.usernameField).type(
    process.env.FRONTLINE_USERNAME,
    { delay: Math.floor(Math.random() * 80) + 80 } // 80-160ms per character
  );

  await humanDelay(300, 800);

  // Type password with human-like delays
  logToFile('Entering password...');
  await page.locator(SELECTORS.login.passwordField).click();
  await humanDelay(200, 400);
  await page.locator(SELECTORS.login.passwordField).fill(''); // Clear first
  await page.locator(SELECTORS.login.passwordField).type(
    process.env.FRONTLINE_PASSWORD,
    { delay: Math.floor(Math.random() * 80) + 80 } // 80-160ms per character
  );

  await humanDelay(200, 600);

  // Click submit
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
    // Popup didn't appear - that's fine
    logToFile('No popup to dismiss');
  }

  // Take screenshot for debugging
  const timestamp = Date.now();
  await page.screenshot({ path: path.join(__dirname, 'debug', `01-after-login-${timestamp}.png`) });
  logToFile('Login complete - screenshot saved');
}

/**
 * Navigate to Available Jobs tab
 * @param {Page} page - Playwright page object
 */
async function navigateToAvailableJobs(page) {
  logToFile('Navigating to Available Jobs tab...');

  // Wait for the tab to be visible
  await page.waitForSelector(SELECTORS.navigation.availableJobsTab, { timeout: 10000 });
  await humanDelay(500, 1000);

  // Click Available Jobs tab (it may already be active, but this ensures it)
  await page.locator(SELECTORS.navigation.availableJobsTab).click();
  await humanDelay(500, 1000);

  // Wait for job listings panel to be visible
  await page.waitForSelector(SELECTORS.navigation.availableJobsPanel, { timeout: 10000 });
  await humanDelay(1000, 2000);

  logToFile('Available Jobs tab loaded');
}

/**
 * Scrape all jobs from the Available Jobs page
 * @param {Page} page - Playwright page object
 * @returns {Promise<Array>} Array of objects containing job data and locator
 */
async function scrapeJobs(page) {
  logToFile('Scraping jobs...');

  // Check if there are no jobs available
  try {
    const noDataRow = page.locator(SELECTORS.jobs.noDataRow);
    const noDataVisible = await noDataRow.isVisible({ timeout: 3000 });

    if (noDataVisible) {
      logToFile('No available jobs at this time');
      return [];
    }
  } catch (error) {
    // No "no data" row found - proceed with scraping
  }

  // Get all job tbody elements
  const jobBodies = await page.locator(SELECTORS.jobs.jobBodies).all();
  logToFile(`Found ${jobBodies.length} job elements`);

  const jobs = [];

  for (let i = 0; i < jobBodies.length; i++) {
    const jobBody = jobBodies[i];

    try {
      // Each job has a summary row and one or more detail rows
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
          // Clean whitespace on each day
          Object.keys(day).forEach(key => {
            if (typeof day[key] === 'string') day[key] = day[key].trim();
          });
          job.days.push(day);
        }
        logToFile(`  Multi-day job detected: ${job.days.length} days`);
      }

      // Clean up whitespace on main fields
      Object.keys(job).forEach(key => {
        if (typeof job[key] === 'string') {
          job[key] = job[key].trim();
        }
      });

      // Include the locator so we can capture DOM/screenshots later
      jobs.push({ job, jobBody, index: i });

    } catch (error) {
      logToFile(`Error scraping job at index ${i}: ${error.message}`);
    }
  }

  logToFile(`Successfully scraped ${jobs.length} jobs`);
  return jobs;
}

/**
 * FUTURE FEATURE: Book a job automatically
 *
 * This function will be implemented once we have the booking button selector.
 * It will:
 * 1. Click the booking/accept button on the job card
 * 2. Handle any confirmation dialogs
 * 3. Verify the booking was successful
 * 4. Send confirmation notification to Telegram
 *
 * @param {Page} page - Playwright page object
 * @param {Locator} jobBody - The job card element
 * @param {Object} job - The job data
 * @returns {Promise<boolean>} True if booking was successful
 */
async function bookJob(page, jobBody, job) {
  // TODO: Implement automated booking logic
  //
  // Steps:
  // 1. Find and click the "Accept" or "Book" button on the job card
  //    Example: await jobBody.locator('button.accept-job').click();
  //
  // 2. Handle any confirmation dialogs that appear
  //    Example: await page.locator('.confirm-dialog button:has-text("Confirm")').click();
  //
  // 3. Wait for confirmation/success message
  //    Example: await page.waitForSelector('.success-message', { timeout: 10000 });
  //
  // 4. Verify booking was successful by checking for confirmation number or success state
  //
  // 5. Send success notification via Telegram
  //    Example: await sendTelegramMessage(`✅ Successfully booked job: ${job.position} at ${job.school}`);
  //
  // 6. Return true if successful, false if failed

  logToFile('⚠️  Automated booking not yet implemented');
  return false;
}

/**
 * FUTURE FEATURE: Send job notification and wait for user confirmation
 *
 * This function will be enhanced to support Telegram bot interaction:
 * 1. Send job details with inline keyboard (Yes/No buttons)
 * 2. Wait for user response
 * 3. If "Yes", call bookJob() to automatically book
 * 4. If "No", skip and mark as ignored
 *
 * For now, it just sends a notification without waiting for response.
 *
 * @param {Object} job - The job data
 * @param {boolean} uncertain - Whether this is an uncertain match
 * @returns {Promise<string>} 'book' | 'ignore' | 'timeout' | 'notified_only'
 */
async function notifyAndAwaitConfirmation(job, uncertain) {
  // TODO: Enhance with Telegram inline keyboard and response handling
  //
  // Steps:
  // 1. Format job notification with inline keyboard buttons
  //    const keyboard = {
  //      inline_keyboard: [[
  //        { text: '✅ Book This Job', callback_data: `book:${jobHash}` },
  //        { text: '❌ Ignore', callback_data: `ignore:${jobHash}` }
  //      ]]
  //    };
  //
  // 2. Send message with keyboard and store message ID
  //
  // 3. Set up callback handler to listen for button clicks
  //
  // 4. Wait for response (with timeout, e.g., 5 minutes)
  //
  // 5. Return user's choice: 'book' | 'ignore' | 'timeout'

  // For now, just send notification without waiting
  await sendJobNotification(job, uncertain);
  return 'notified_only';
}

/**
 * Main scraper function
 */
async function main() {
  let browser = null;

  try {
    // 1. Check operating hours
    if (!isOperatingHours()) {
      logToFile('Outside operating hours (5 AM - 8 PM MT, Mon-Fri). Exiting.');
      clearTimeout(globalTimeout);
      process.exit(0);
    }

    logToFile('=== Starting scraper run ===');

    // 2. Ensure directories exist
    await ensureDirectories();

    // 3. Load notified jobs list
    let notifiedJobs = await loadNotifiedJobs();
    logToFile(`Loaded ${Object.keys(notifiedJobs).length} previously notified jobs`);

    // 4. Launch browser with human-like configuration
    logToFile('Launching browser...');
    browser = await chromium.launch({
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

    // 5. Login to Frontline
    await login(page);

    // 6. Navigate to Available Jobs
    await navigateToAvailableJobs(page);

    // 7. Scrape all jobs (returns array with job data AND locators)
    const jobsData = await scrapeJobs(page);

    // 7a. Take screenshot of available jobs page with job count in filename
    const timestamp = Date.now();
    const jobCount = jobsData.length;
    await page.screenshot({
      path: path.join(__dirname, 'debug', `02-available-jobs-${jobCount}jobs-${timestamp}.png`)
    });
    logToFile(`Available Jobs screenshot saved: ${jobCount} jobs found`);

    // 8. Filter jobs and capture DOM/screenshots for matching ones
    const matchedJobs = [];
    for (const { job, jobBody, index } of jobsData) {
      const filterResult = filterJob(job);

      if (filterResult.match) {
        matchedJobs.push({ job, jobBody, index, filterResult });
        logToFile(`✓ Matched: ${job.position} at ${job.school} - ${filterResult.reason}`);

        // FUTURE PREP: Capture DOM and screenshot of this matching job card
        await captureJobCardDOM(jobBody, job, index);
        await captureJobCardScreenshot(jobBody, job, index);

      } else {
        logToFile(`✗ Rejected: ${job.position} at ${job.school} - ${filterResult.reason}`);
      }
    }

    logToFile(`Found ${matchedJobs.length} matching jobs out of ${jobsData.length} total`);

    // 9. Check against notified list and send notifications for new matches
    let newJobsNotified = 0;
    for (const { job, jobBody, filterResult } of matchedJobs) {
      const jobHash = createJobHash(job);

      if (!notifiedJobs[jobHash]) {
        // New job - send notification
        logToFile(`🔔 New job to notify: ${job.position} at ${job.school}`);

        try {
          // Send notification (future: this will include yes/no buttons)
          const userResponse = await notifyAndAwaitConfirmation(job, filterResult.uncertain);

          // Mark as notified
          notifiedJobs[jobHash] = Date.now();
          newJobsNotified++;

          // FUTURE: Handle user response
          // if (userResponse === 'book') {
          //   const bookingSuccess = await bookJob(page, jobBody, job);
          //   if (bookingSuccess) {
          //     logToFile(`✅ Successfully booked job: ${job.position}`);
          //   } else {
          //     logToFile(`❌ Failed to book job: ${job.position}`);
          //   }
          // } else if (userResponse === 'ignore') {
          //   logToFile(`⏭️  User chose to ignore job: ${job.position}`);
          // }

          // Small delay between notifications to avoid rate limiting
          if (newJobsNotified < matchedJobs.length) {
            await humanDelay(1000, 2000);
          }
        } catch (error) {
          logToFile(`Failed to send notification: ${error.message}`);
        }
      } else {
        logToFile(`Already notified about: ${job.position} at ${job.school}`);
      }
    }

    // 10. Send summary notification (only when there are matching jobs)
    if (newJobsNotified > 0) {
      try {
        await sendSummaryNotification(jobsData.length, matchedJobs.length, newJobsNotified);
      } catch (error) {
        logToFile(`Failed to send summary: ${error.message}`);
      }
    }

    // 11. Clean up old entries and save
    notifiedJobs = cleanOldNotifications(notifiedJobs);
    await saveNotifiedJobs(notifiedJobs);

    // 11a. Clean up old debug files (screenshots and HTML)
    await cleanupOldDebugFiles(DEBUG_FILE_RETENTION_DAYS);

    // 12. Log summary
    logToFile(`=== Scraper run complete ===`);
    logToFile(`Total jobs: ${jobsData.length}`);
    logToFile(`Matched jobs: ${matchedJobs.length}`);
    logToFile(`New jobs notified: ${newJobsNotified}`);

    // 13. Close browser
    await browser.close();
    clearTimeout(globalTimeout);
    process.exit(0);

  } catch (error) {
    logToFile(`❌ ERROR: ${error.message}`);
    console.error('Error:', error);

    // Take error screenshot if browser is still running
    if (browser) {
      try {
        const pages = await browser.contexts().then(c => c[0]?.pages() || []);
        if (pages.length > 0) {
          const timestamp = Date.now();
          await pages[0].screenshot({ path: path.join(__dirname, 'debug', `error-${timestamp}.png`) });
          logToFile(`Error screenshot saved: error-${timestamp}.png`);
        }
      } catch (screenshotError) {
        logToFile(`Failed to capture error screenshot: ${screenshotError.message}`);
      }
    }

    // Send error alert to Telegram
    try {
      await sendErrorAlert(error.message);
    } catch (notifyError) {
      logToFile(`Failed to send error notification: ${notifyError.message}`);
    }

    // Clean up
    if (browser) {
      await browser.close();
    }
    clearTimeout(globalTimeout);
    process.exit(1);
  }
}

// Run the scraper
main();
