/**
 * Telegram Notification Module
 *
 * Handles sending notifications to Telegram for new job opportunities and errors.
 * Uses the Telegram Bot API directly via fetch (no library needed).
 *
 * Also provides inline keyboard support for auto-booking:
 * - sendJobNotificationWithKeyboard() — sends notification with Book/Ignore buttons
 * - pollCallbackQueries() — polls for user button presses
 * - answerCallback() — acknowledges a callback query
 * - updateMessageAfterAction() — edits message to reflect booking status
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

  if (job.isMultiDay && job.days.length > 0) {
    // Multi-day job format
    message += '🏫 <b>New Multi-Day Sub Job Available!</b>\n\n';
    message += `📚 <b>Subject:</b> ${job.position}\n`;
    message += `🏫 <b>School:</b> ${job.school}\n`;
    message += `👤 <b>Teacher:</b> ${job.teacher}\n`;
    message += `🔢 <b>Job #:</b> ${job.jobNumber}\n\n`;
    message += `📅 <b>Days (${job.days.length}):</b>\n`;
    for (const day of job.days) {
      message += `  • ${day.date} — ${day.startTime}-${day.endTime} (${day.duration})\n`;
    }
    message += '\n';
  } else {
    // Single-day job format
    message += '🏫 <b>New Sub Job Available!</b>\n\n';
    message += `📅 <b>Date:</b> ${job.date}\n`;
    message += `🏫 <b>School:</b> ${job.school}\n`;
    message += `📚 <b>Subject:</b> ${job.position}\n`;
    message += `👤 <b>Teacher:</b> ${job.teacher}\n`;
    message += `⏰ <b>Time:</b> ${job.startTime} - ${job.endTime}\n`;
    message += `⏱️ <b>Duration:</b> ${job.duration}\n`;
    message += `🔢 <b>Job #:</b> ${job.jobNumber}\n\n`;
  }

  message += `👉 <b><a href="${process.env.FRONTLINE_LOGIN_URL}">Click here to log in and book!</a></b>`;

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
 * @param {number} uncertainNotified - How many of the notified jobs were uncertain matches
 * @returns {Promise<Object>} The API response
 */
export async function sendSummaryNotification(totalJobs, matchedJobs, notifiedJobs, uncertainNotified = 0) {
  const uncertainLine = uncertainNotified > 0
    ? `\n⚠️ Uncertain matches: ${uncertainNotified}`
    : '';

  const message = `
📊 <b>Scraper Run Summary</b>

🔍 Total jobs found: ${totalJobs}
✅ Jobs matching filters: ${matchedJobs}
🔔 New jobs notified: ${notifiedJobs}${uncertainLine}

${notifiedJobs > 0 ? '👆 Check messages above for details!' : '💤 No new jobs this time.'}
  `.trim();

  return await sendTelegramMessage(message);
}

// ============================================================================
// AUTO-BOOKING: Inline Keyboard + Callback Polling
// ============================================================================

/**
 * Send an auto-booking notification (no buttons — just informing the user).
 * The message will be updated later with the booking result.
 * @param {Object} job - The job object
 * @param {number} daysAhead - How many days until the job
 * @returns {Promise<number|null>} The message_id from Telegram (for later editing)
 */
export async function sendAutoBookNotification(job, daysAhead) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Telegram credentials not configured in .env file');
  }

  const jobText = formatJobNotification(job, false);
  const text = `🤖 <b>AUTO-BOOKING</b> (${daysAhead} days away, safe to cancel)\n\n${jobText}`;

  const url = `${TELEGRAM_API_URL}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
    }

    const data = await response.json();
    return data.result?.message_id || null;
  } catch (error) {
    console.error('Failed to send auto-book notification:', error.message);
    throw error;
  }
}

/**
 * Send a job notification with Book/Ignore inline keyboard buttons.
 * @param {Object} job - The job object
 * @param {boolean} uncertain - Whether this is an uncertain match
 * @param {string} jobHash - Unique hash for this job (used in callback_data)
 * @returns {Promise<number|null>} The message_id from Telegram (for later editing), or null on failure
 */
export async function sendJobNotificationWithKeyboard(job, uncertain, jobHash) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Telegram credentials not configured in .env file');
  }

  const text = formatJobNotification(job, uncertain);

  const url = `${TELEGRAM_API_URL}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: '📖 Book This Job', callback_data: `book:${jobHash}` },
        { text: '❌ Ignore', callback_data: `ignore:${jobHash}` },
      ]],
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
    }

    const data = await response.json();
    return data.result?.message_id || null;
  } catch (error) {
    console.error('Failed to send keyboard notification:', error.message);
    throw error;
  }
}

/**
 * Poll Telegram for callback queries (button presses).
 * Non-blocking short poll (timeout=0) — call this each scrape cycle.
 * @param {number} lastUpdateOffset - The offset from the last poll (start with 0)
 * @returns {Promise<{queries: Array, newOffset: number}>}
 */
export async function pollCallbackQueries(lastUpdateOffset = 0) {
  if (!TELEGRAM_BOT_TOKEN) {
    return { queries: [], newOffset: lastUpdateOffset };
  }

  const url = `${TELEGRAM_API_URL}/getUpdates?offset=${lastUpdateOffset}&timeout=0&allowed_updates=${encodeURIComponent(JSON.stringify(['callback_query']))}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { queries: [], newOffset: lastUpdateOffset };
    }

    const data = await response.json();
    const updates = data.result || [];

    if (updates.length === 0) {
      return { queries: [], newOffset: lastUpdateOffset };
    }

    // Extract callback queries and compute next offset
    const queries = updates
      .filter(u => u.callback_query)
      .map(u => u.callback_query);

    const newOffset = updates[updates.length - 1].update_id + 1;

    return { queries, newOffset };
  } catch (error) {
    console.error('Failed to poll callback queries:', error.message);
    return { queries: [], newOffset: lastUpdateOffset };
  }
}

/**
 * Answer a callback query (dismisses Telegram's loading spinner).
 * @param {string} callbackQueryId - The callback_query.id from Telegram
 * @param {string} text - Short text to show as a toast notification
 * @returns {Promise<void>}
 */
export async function answerCallback(callbackQueryId, text) {
  const url = `${TELEGRAM_API_URL}/answerCallbackQuery`;
  const payload = {
    callback_query_id: callbackQueryId,
    text: text,
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Failed to answer callback:', error.message);
  }
}

/**
 * Edit an existing Telegram message to update its text and remove the inline keyboard.
 * Used after a booking action (book/ignore/expire/fail).
 * @param {number} messageId - The message_id to edit
 * @param {Object} job - The job object
 * @param {boolean} uncertain - Whether this was an uncertain match
 * @param {string} statusLine - Status text to append (e.g., "✅ BOOKED", "❌ IGNORED")
 * @param {object} [options] - Optional settings
 * @param {boolean} [options.autoBooked] - Whether this was an auto-booked job
 * @param {number} [options.daysAhead] - Days ahead (for auto-book prefix)
 * @returns {Promise<void>}
 */
export async function updateMessageAfterAction(messageId, job, uncertain, statusLine, options = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  let originalText = formatJobNotification(job, uncertain);
  if (options.autoBooked && options.daysAhead != null) {
    originalText = `🤖 <b>AUTO-BOOKING</b> (${options.daysAhead} days away, safe to cancel)\n\n${originalText}`;
  }
  const updatedText = `${originalText}\n\n--- ${statusLine} ---`;

  const url = `${TELEGRAM_API_URL}/editMessageText`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    message_id: messageId,
    text: updatedText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] }, // Remove keyboard
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Failed to update message:', error.message);
  }
}
