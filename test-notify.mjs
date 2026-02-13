#!/usr/bin/env node
/**
 * Telegram Notification Test Script
 *
 * This script tests the Telegram Bot API connection independently.
 * Run with: pnpm run test-notify
 */

import { sendTelegramMessage } from './notify.mjs';

async function testTelegramConnection() {
  console.log('🧪 Testing Telegram connection...\n');

  try {
    const testMessage = '✅ <b>Sub Job Scraper is connected!</b>\n\nNotifications will appear here when new matching jobs are found.';

    console.log('Sending test message to Telegram...');
    const response = await sendTelegramMessage(testMessage);

    if (response.ok) {
      console.log('\n✅ SUCCESS! Test message sent to Telegram.');
      console.log('📱 Check your Telegram group to confirm you received it.\n');
      console.log('Response:', JSON.stringify(response, null, 2));
    } else {
      console.log('\n❌ FAILED! Telegram API returned an error.');
      console.log('Response:', JSON.stringify(response, null, 2));
    }
  } catch (error) {
    console.error('\n❌ ERROR! Failed to send test message.');
    console.error('Error message:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Check that TELEGRAM_BOT_TOKEN is set correctly in .env');
    console.error('2. Check that TELEGRAM_CHAT_ID is set correctly in .env');
    console.error('3. Verify the bot is a member of the group chat');
    console.error('4. Ensure the bot has permission to send messages\n');
    process.exit(1);
  }
}

// Run the test
testTelegramConnection();
