/**
 * Telegram Notification Module
 *
 * Handles sending notifications to Telegram for new job opportunities and errors.
 * Uses the Telegram Bot API directly via fetch (no library needed).
 */

import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Send a message to Telegram using the Bot API
 * @param {string} text - The message text to send
 * @returns {Promise<Object>} The API response
 */
export async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Telegram credentials not configured in .env file');
  }

  const url = `${TELEGRAM_API_URL}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML', // Enable HTML formatting for bold/italic
    disable_web_page_preview: true, // Don't show link previews
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to send Telegram message:', error.message);
    throw error;
  }
}

/**
 * Format a job notification message with emojis and structure
 * @param {Object} job - The job object
 * @param {boolean} uncertain - Whether this is an uncertain match
 * @returns {string} Formatted message text
 */
export function formatJobNotification(job, uncertain = false) {
  let message = '';

  // Add warning for uncertain matches
  if (uncertain) {
    message += '⚠️ <b>UNCERTAIN MATCH</b> — Review this one:\n\n';
  }

  message += '🏫 <b>New Sub Job Available!</b>\n\n';
  message += `📅 <b>Date:</b> ${job.date}\n`;
  message += `🏫 <b>School:</b> ${job.school}\n`;
  message += `📚 <b>Subject:</b> ${job.position}\n`;
  message += `👤 <b>Teacher:</b> ${job.teacher}\n`;
  message += `⏰ <b>Time:</b> ${job.startTime} - ${job.endTime}\n`;
  message += `⏱️ <b>Duration:</b> ${job.duration}\n`;
  message += `🔢 <b>Job #:</b> ${job.jobNumber}\n\n`;
  message += '👉 <b>Log in to Frontline to accept!</b>';

  return message;
}

/**
 * Send a job notification to Telegram
 * @param {Object} job - The job object
 * @param {boolean} uncertain - Whether this is an uncertain match
 * @returns {Promise<Object>} The API response
 */
export async function sendJobNotification(job, uncertain = false) {
  const message = formatJobNotification(job, uncertain);
  return await sendTelegramMessage(message);
}

/**
 * Send an error alert to Telegram
 * @param {string} errorMessage - The error message to send
 * @returns {Promise<Object>} The API response
 */
export async function sendErrorAlert(errorMessage) {
  const message = `
🚨 <b>Scraper Error</b>

An error occurred while running the substitute job scraper:

<code>${errorMessage}</code>

Please check the logs for more details.
  `.trim();

  return await sendTelegramMessage(message);
}

/**
 * Send a summary notification (useful for testing or daily summaries)
 * @param {number} totalJobs - Total jobs found
 * @param {number} matchedJobs - Jobs that matched filters
 * @param {number} notifiedJobs - New jobs notified about
 * @returns {Promise<Object>} The API response
 */
export async function sendSummaryNotification(totalJobs, matchedJobs, notifiedJobs) {
  const message = `
📊 <b>Scraper Run Summary</b>

🔍 Total jobs found: ${totalJobs}
✅ Jobs matching filters: ${matchedJobs}
🔔 New jobs notified: ${notifiedJobs}

${notifiedJobs > 0 ? '👆 Check messages above for details!' : '💤 No new jobs this time.'}
  `.trim();

  return await sendTelegramMessage(message);
}
