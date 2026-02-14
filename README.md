# Frontline Education Substitute Job Scraper & Notifier

Automated web scraper that monitors Frontline Education (formerly AESOP) for substitute teaching jobs, filters them based on your criteria, and sends Telegram notifications when matching opportunities appear.

## Features

- ✅ **Automated scraping** every 10 minutes via macOS launchd
- 🎯 **Smart filtering** by school level, subject, duration, and blacklisted schools
- 📱 **Telegram notifications** with clickable links for instant booking
- 🚫 **Duplicate prevention** - tracks notified jobs to avoid repeat notifications
- 🤖 **Human-like behavior** - random delays to avoid bot detection
- 💻 **Lid-closed operation** - works with MacBook lid closed when on AC power
- 📸 **Debug capture** - screenshots and DOM logs for troubleshooting
- 🔮 **Future-ready** - prepared for automated job booking with Telegram bot confirmation

## Operating Hours

The scraper runs:
- **Every day** (Monday - Sunday)
- **5:00 AM - 11:00 PM** Mountain Time

Outside these hours, the scraper exits immediately when triggered by launchd.

## Prerequisites

- **macOS** (Apple Silicon or Intel)
- **Node.js v22+** (installed via nvm recommended)
- **pnpm** package manager
- **Telegram** account with:
  - Bot created via [@BotFather](https://t.me/botfather)
  - Bot added to a group chat
  - Bot token and chat ID ready

## Installation

### 1. Clone/Download Project

```bash
cd ~/personal_projects
# Project should be at: /Users/mckaysnell/personal_projects/sub_teacher_scaper
```

### 2. Install Dependencies

```bash
cd sub_teacher_scaper
pnpm install
```

This will install:
- `playwright` - Browser automation
- `dotenv` - Environment variables
- `node-telegram-bot-api` - Telegram notifications

### 3. Install Playwright Chromium

```bash
pnpm exec playwright install chromium
```

### 4. Configure Environment Variables

The `.env` file should already exist with your credentials. If not, create it:

```bash
cp .env.example .env
```

Then edit `.env` and fill in:

```env
# Frontline Education Credentials
FRONTLINE_USERNAME=your_username
FRONTLINE_PASSWORD="your_password"
FRONTLINE_LOGIN_URL=https://login.frontlineeducation.com/login?signin=...

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

**Note:** Use quotes around the password if it starts with special characters (like `=`).

### 5. Test Telegram Connection

```bash
pnpm run test-notify
```

You should see a test message in your Telegram group chat. If not, verify your bot token and chat ID.

### 6. Test Manual Scrape

```bash
pnpm run scrape
```

This will:
- Launch browser
- Login to Frontline
- Scrape available jobs
- Filter based on criteria
- Send notifications for matches
- Save screenshots to `debug/`
- Log activity to `logs/scraper.log`

**Check the output:**
- `logs/scraper.log` - Full activity log
- `debug/` - Screenshots of login and available jobs page
- `logs/job-card-dom-examples.html` - Captured DOM structure of matching jobs (for future auto-booking)

### 7. Verify Selectors (if needed)

If jobs aren't being scraped correctly:

1. Open the most recent `debug/02-available-jobs-{N}jobs-[timestamp].png`
2. Compare with `selectors.mjs`
3. Update selectors if Frontline's UI has changed
4. Re-run `pnpm run scrape` to test

### 8. Enable Scheduled Runs

Once manual testing works:

```bash
pnpm run schedule
```

This creates a launchd agent that runs the scraper every 10 minutes.

## Usage

### Check if Schedule is Running

```bash
launchctl list | grep subjobs
```

If running, you'll see output like:
```
-	0	com.subjobs.scraper
```

### View Logs

**Scraper activity log:**
```bash
tail -f logs/scraper.log
```

**launchd stdout/stderr:**
```bash
tail -f logs/launchd-stdout.log
tail -f logs/launchd-stderr.log
```

### Stop Scheduled Runs

```bash
pnpm run unschedule
```

### Run Manually (for testing)

```bash
pnpm run scrape
```

This runs once immediately, ignoring operating hours.

### Visual vs Headless Browser Mode

The project supports both visible and headless browser operation:

**Scheduled runs** (automatic):
- Uses headless mode (no visible browser)
- Runs silently in background
- Optimized for automation

**Manual testing** (`pnpm run scrape`):
- Shows visible browser window
- Watch the automation in real-time
- Useful for debugging and verification

This allows you to test visually anytime without affecting automated scheduled runs.

### Run with MacBook Lid Closed

The scraper works with the MacBook lid closed if:
- ✅ Connected to AC power
- ✅ Connected to WiFi
- ✅ Mac configured to not sleep on AC power

**Verify your power settings:**
```bash
pmset -g custom
```

Look for `AC Power: sleep 0` - this means your Mac won't sleep when plugged in.

**If needed, disable sleep on AC power:**
```bash
sudo pmset -c sleep 0
```

This allows the scraper to run every 10 minutes even with the lid closed.

## Filtering Criteria

### Accepted School Levels
- High School
- Junior High / Jr. High
- Middle School

### Rejected School Levels
- Elementary
- Primary
- Kindergarten
- Pre-K

### Accepted Subjects
- **History/Social Sciences**: US History, World History, Government, Geography, Economics, Sociology, Psychology, Political Science, Civics
- **English/Language Arts**: English, Literature, Writing, Composition
- **Music**: Band, Orchestra (NOT choir)
- **Sciences**: Biology, Chemistry, Physics, Earth Science, Environmental Science, Anatomy
- **Arts**: Art, Visual Arts, Drawing, Painting, Ceramics, Drama, Theater/Theatre

### Rejected Subjects
- **Languages**: Spanish, French, German, Chinese, Japanese, ASL, ESL
- **Math & Computer Science**: Math, Algebra, Geometry, Calculus, Statistics, Computer Science, Coding
- **Choir**: Choir, Chorus, Choral
- **Other**: Health, PE, Physical Education, Gym, Driver's Ed, Home Economics, Special Education

### Blacklisted Schools
- Westlake High School
- Saratoga Springs
- Vista Heights Middle School

### Duration Requirement
- **Only "Full Day" jobs** are accepted
- Half Day (AM/PM) jobs are automatically rejected

## Telegram Notifications

When a matching job is found, you'll receive a Telegram notification with:

- 📅 **Date**: When the job is scheduled
- 🏫 **School**: School name
- 📚 **Subject**: Position/subject area
- 👤 **Teacher**: Teacher's name
- ⏰ **Time**: Start and end times
- ⏱️ **Duration**: Full Day (or duration type)
- 🔢 **Job #**: Confirmation number
- 🔗 **Clickable link**: Direct link to Frontline login page

**Click the link in the notification to instantly open Frontline and book the job!** The link takes you directly to the login page, so you can quickly log in and claim the position before other substitutes.

## Modifying Filters

Edit `filters.mjs` to change criteria:

**Add an accepted subject:**
```javascript
export const ACCEPTED_SUBJECTS = [
  // ... existing subjects
  'forensics', // Add new subject
];
```

**Add a blacklisted school:**
```javascript
export const REJECTED_SCHOOLS = [
  // ... existing schools
  'another school name',
];
```

**Change operating hours:**

Edit `utils.mjs`:
```javascript
export function isOperatingHours() {
  const now = getCurrentMountainTime();
  const hour = now.getHours();

  // Change these values:
  const isActiveHours = hour >= 5 && hour < 23; // 5 AM to 11 PM

  return isActiveHours;
}
```

**Change debug file retention:**

Debug screenshots are automatically cleaned up to prevent disk space issues. By default, files older than 3 days are deleted at the end of each scraper run.

To change the retention period, edit the `DEBUG_FILE_RETENTION_DAYS` constant in both `scraper.mjs` and `run-once.mjs`:

```javascript
// Keep debug screenshots for 3 days (108 runs/day = ~324 screenshots/day)
const DEBUG_FILE_RETENTION_DAYS = 3; // Change to desired number of days
```

With default settings (3 days), you'll have approximately 650-700 screenshots in the `debug/` folder at any given time.

## Debug Screenshots

Screenshots are automatically captured during each run and include helpful information in the filename:

- **`01-after-login-{timestamp}.png`** - Login page state (for debugging authentication)
- **`02-available-jobs-{N}jobs-{timestamp}.png`** - Available jobs page where `{N}` is the number of jobs found
  - Example: `02-available-jobs-5jobs-1234567890.png` means 5 jobs were present
  - Example: `02-available-jobs-0jobs-1234567890.png` means no jobs found
- **`job-card-{index}-{date}-{timestamp}.png`** - Individual matching job cards (for future auto-booking)
- **`error-{timestamp}.png`** - Error state screenshots (when something goes wrong)

This makes it easy to identify at a glance which screenshots contain actual job listings vs. empty results.

## File Structure

```
sub_teacher_scaper/
├── .env                           # Environment variables (gitignored)
├── .env.example                   # Template for .env
├── .gitignore                     # Git ignore rules
├── package.json                   # Dependencies and scripts
├── README.md                      # This file
├── CLAUDE.md                      # Project context for Claude Code
│
├── scraper.mjs                    # Main scraper logic
├── filters.mjs                    # Job filtering rules
├── notify.mjs                     # Telegram notification helpers
├── selectors.mjs                  # DOM selectors
├── utils.mjs                      # Shared utility functions
│
├── test-notify.mjs                # Test Telegram connection
├── run-once.mjs                   # Manual one-off run
├── install-schedule.sh            # Install launchd agent
├── uninstall-schedule.sh          # Remove launchd agent
│
├── data/
│   └── notified-jobs.json         # Tracks notified jobs
│
├── debug/
│   ├── 01-after-login-*.png              # Login screenshots
│   ├── 02-available-jobs-{N}jobs-*.png   # Available jobs page (N = job count, e.g., 5jobs or 0jobs)
│   ├── job-card-*.png                    # Individual job card screenshots (matching jobs only)
│   └── error-*.png                       # Error screenshots
│   # Note: Files older than 3 days are automatically cleaned up
│
└── logs/
    ├── scraper.log                # Main activity log
    ├── job-card-dom-examples.html # DOM structure of matching jobs (for future auto-booking)
    ├── launchd-stdout.log         # launchd stdout
    └── launchd-stderr.log         # launchd stderr
```

## Troubleshooting

### Telegram notifications not sending

1. Test connection: `pnpm run test-notify`
2. Verify bot token and chat ID in `.env`
3. Ensure bot is member of the group chat
4. Check logs for errors: `tail -f logs/scraper.log`

### Jobs not being scraped

1. Check screenshots: `ls -lt debug/02-available-jobs-*.png | head -5` (look for ones with job count > 0)
2. Open recent screenshot with jobs: `open debug/02-available-jobs-*jobs-*.png`
3. Verify selectors match current Frontline UI structure
4. Update `selectors.mjs` if needed
5. Re-test with `pnpm run scrape`

**Tip:** Screenshot filenames include job count (e.g., `5jobs` or `0jobs`), making it easy to find examples with actual jobs.

### Login failing

1. Verify credentials in `.env`
2. Check screenshot: `open debug/01-after-login-*.png`
3. Ensure password is quoted if it starts with special characters
4. Test manually: `pnpm run scrape`

### Schedule not running

1. Check if loaded: `launchctl list | grep subjobs`
2. View launchd errors: `tail -f logs/launchd-stderr.log`
3. Verify Node.js path in `install-schedule.sh` matches your installation: `which node`
4. Reload schedule: `pnpm run unschedule && pnpm run schedule`

### Outside operating hours

If the scraper exits immediately with "Outside operating hours", this is normal behavior during:
- **12:00 AM - 4:59 AM** (midnight to 5 AM)
- **11:00 PM - 11:59 PM** (after 11 PM)

## Future Features

### Automated Job Booking

The scraper is prepared for future automated booking with:

1. **DOM capture** - Matching job cards are logged to `logs/job-card-dom-examples.html`
2. **Screenshots** - Individual job cards saved to `debug/job-card-*.png`
3. **Placeholder functions** - `bookJob()` and `notifyAndAwaitConfirmation()` ready for implementation

When ready to implement auto-booking:
1. Use captured DOM examples to identify the "Accept/Book" button selector
2. Add selector to `selectors.mjs`
3. Implement the `bookJob()` function in `scraper.mjs`
4. Enhance Telegram bot to support inline keyboard (Yes/No buttons)
5. Implement callback handling for user responses

## Support

For issues or questions:
- Check `logs/scraper.log` for detailed activity
- Examine `debug/` screenshots for visual debugging
- Review `CLAUDE.md` for project context and development guidelines

## License

Personal project - Not for redistribution
