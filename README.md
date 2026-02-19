# Frontline Education Substitute Job Scraper & Notifier

Automated web scraper that monitors [Frontline Education](https://www.frontlineeducation.com/) (formerly AESOP) for substitute teaching jobs, filters them based on configurable criteria, and sends Telegram notifications with one-tap booking. Runs as a persistent macOS daemon checking every 30 seconds.

Built because services like [SubSideKick](https://subsidekick.com/) charge $10/month for similar functionality.

## Features

- **Persistent daemon** — checks every 30 seconds (not cold-start intervals)
- **Smart filtering** — school level, subject, duration, blacklisted schools, nearby schools, blackout dates
- **Telegram notifications** with inline Book/Ignore buttons
- **Auto-booking** — certain matches 3+ days out are booked instantly (safe cancellation window)
- **Monitoring dashboard** — local web UI with live stats, charts, and log viewer
- **Human-like behavior** — random delays and typing patterns to avoid bot detection
- **Self-healing** — automatic session recovery, browser restarts, crash recovery via launchd
- **Lid-closed operation** — works with MacBook lid closed on AC power

## How It Works

```
Daemon Loop (every 30 seconds):
  1. Refresh page (detect session expiry → auto re-login)
  2. Poll Telegram for Book/Ignore button presses
  3. Execute any pending bookings
  4. Scrape available jobs
  5. Filter against criteria (school, subject, duration, blackout dates)
  6. For certain matches 3+ days away → auto-book immediately
  7. For uncertain matches or close dates → send Book/Ignore buttons
  8. Write heartbeat + stats for dashboard
```

## Prerequisites

- **macOS** (uses launchd for scheduling)
- **Node.js v22+** (via nvm recommended)
- **pnpm** package manager
- **Telegram** account with a bot (created via [@BotFather](https://t.me/botfather))

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd sub_teacher_scaper
pnpm install
pnpm exec playwright install chromium

# 2. Configure credentials
cp .env.example .env
# Edit .env with your Frontline and Telegram credentials

# 3. Test Telegram connection
pnpm run test-notify

# 4. Test scraper manually (visible browser)
pnpm run scrape

# 5. Start the persistent daemon
pnpm run schedule
```

## Environment Variables

Create a `.env` file from `.env.example`:

| Variable | Description |
|----------|-------------|
| `FRONTLINE_USERNAME` | Your Frontline Education username |
| `FRONTLINE_PASSWORD` | Your password (quote if it has special chars) |
| `FRONTLINE_LOGIN_URL` | Full login URL for your school district |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Chat ID (negative number for groups) |

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run scrape` | Run once manually (visible browser, ignores operating hours) |
| `pnpm run daemon` | Run daemon in foreground (for development) |
| `pnpm run schedule` | Install as launchd persistent daemon |
| `pnpm run unschedule` | Stop and remove launchd daemon |
| `pnpm run dashboard` | Start monitoring dashboard (http://localhost:3847) |
| `pnpm run test-notify` | Test Telegram connection |

## Filtering Criteria

All filters are configured in `filters.mjs`.

### School Levels
- **Accepted**: High School, Junior High, Middle School, Intermediate
- **Rejected**: Elementary, Primary, Kindergarten, Pre-K

### Subjects
- **Accepted**: History, English/LA, Math, Science, Music (band/orchestra), Arts, CTE, Drama
- **Rejected**: Foreign languages, Computer Science, Choir, PE, Special Ed, Driver's Ed

### Schools
- **Blacklisted**: Specific schools that return uncertain matches even for accepted subjects
- **Nearby**: Schools near your area get special half-day handling

### Blackout Dates
Block specific dates or date ranges (trips, days off, etc.):
```javascript
export const BLACKOUT_DATES = [
  { start: '2026-03-18', end: '2026-04-08', label: 'Korea trip' },
  { start: '2026-04-13', end: '2026-04-13', label: 'Birthday' },
];
```

### Duration
- Only **Full Day** jobs are accepted (Half Day rejected by default)

## Auto-Booking Logic

| Condition | Action |
|-----------|--------|
| Certain match + 3+ days away | Auto-book immediately |
| Uncertain match (any date) | Send Book/Ignore buttons (5 min expiry) |
| Certain match + < 3 days away | Send Book/Ignore buttons (5 min expiry) |
| Blackout date | Reject entirely |

The 3-day threshold provides a cancellation buffer (Frontline's cutoff is 48 hours).

## Monitoring Dashboard

```bash
pnpm run dashboard
# Open http://localhost:3847
```

Shows live stats, 14-day history charts, recent checks, error log, and booking actions. Auto-refreshes every 30 seconds.

## Daemon Management

```bash
# Check if running
launchctl list | grep subjobs

# View logs
tail -f logs/scraper.log

# Check heartbeat (should be < 2 min old)
cat data/heartbeat.json

# Restart
pnpm run unschedule && pnpm run schedule
```

### Lid-Closed Operation

Works with MacBook lid closed if on AC power + WiFi. Verify with:
```bash
pmset -g custom
# Look for "AC Power: sleep 0"
# If not set: sudo pmset -c sleep 0
```

## File Structure

```
sub_teacher_scaper/
├── scraper.mjs              # Persistent daemon (login, scrape, filter, auto-book)
├── filters.mjs              # Filtering rules (schools, subjects, blackout dates)
├── notify.mjs               # Telegram notifications + inline keyboards
├── selectors.mjs            # DOM selectors for Frontline UI
├── utils.mjs                # Shared utilities (delays, logging, heartbeat, stats)
├── run-once.mjs             # One-shot manual testing (visible browser)
├── test-notify.mjs          # Test Telegram connection
├── install-schedule.sh      # Install launchd daemon
├── uninstall-schedule.sh    # Remove launchd daemon
├── dashboard/
│   ├── server.mjs           # Dashboard HTTP server (port 3847)
│   └── public/              # Dashboard frontend (Chart.js)
├── data/                    # Runtime data (gitignored)
│   ├── notified-jobs.json   # Job state machine
│   ├── scraper-stats.json   # Stats for dashboard
│   └── heartbeat.json       # Daemon health check
├── debug/                   # Screenshots (gitignored, auto-cleaned)
└── logs/                    # Log files (gitignored, auto-rotated)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Jobs not being scraped | Check `debug/02-available-jobs-*.png`, update `selectors.mjs` |
| Login failing | Verify `.env` credentials, check `debug/01-after-login-*.png` |
| Notifications not sending | Run `pnpm run test-notify`, check bot token + chat ID |
| Daemon seems stuck | Check `cat data/heartbeat.json` (>2 min = stuck), restart |
| Auto-booking not working | Check `data/notified-jobs.json` status field, check debug screenshots |

## Tech Stack

- **[Playwright](https://playwright.dev/)** — browser automation
- **[Telegram Bot API](https://core.telegram.org/bots/api)** — notifications via direct HTTP (no library wrapper)
- **[Chart.js](https://www.chartjs.org/)** — dashboard charts
- **Node.js** built-in `http` module — dashboard server (zero dependencies)
- **macOS launchd** — process management (KeepAlive daemon)
