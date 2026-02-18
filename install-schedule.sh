#!/usr/bin/env bash

#######################################################
# Install launchd Schedule for Substitute Job Scraper
#######################################################
#
# This script creates and loads a launchd agent that runs
# the scraper as a persistent daemon (KeepAlive).
#
# The scraper runs continuously, checking for jobs every
# 30 seconds. It handles operating hours internally
# (sleeps during off-hours instead of exiting).
#
# If the scraper crashes (non-zero exit), launchd restarts
# it automatically. Clean shutdown (exit 0) does NOT restart.
#
# Usage: pnpm run schedule
#

set -e  # Exit on error

PLIST_LABEL="com.subjobs.scraper"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
PROJECT_DIR="/Users/mckaysnell/personal_projects/sub_teacher_scaper"
NODE_PATH="/Users/mckaysnell/.nvm/versions/node/v22.14.0/bin/node"

echo "📦 Installing launchd persistent daemon for substitute job scraper..."
echo ""

# Check if Node.js exists at the specified path
if [ ! -f "$NODE_PATH" ]; then
  echo "❌ ERROR: Node.js not found at $NODE_PATH"
  echo "Please update NODE_PATH in install-schedule.sh to match your Node.js installation"
  echo "Current Node.js location: $(which node)"
  exit 1
fi

# Check if project directory exists
if [ ! -d "$PROJECT_DIR" ]; then
  echo "❌ ERROR: Project directory not found at $PROJECT_DIR"
  exit 1
fi

# Check if scraper.mjs exists
if [ ! -f "$PROJECT_DIR/scraper.mjs" ]; then
  echo "❌ ERROR: scraper.mjs not found in project directory"
  exit 1
fi

# Unload existing agent if it's already loaded
if launchctl list | grep -q "$PLIST_LABEL"; then
  echo "⚠️  Found existing agent - unloading first..."
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
fi

# Create the plist file
echo "📝 Creating plist file at $PLIST_FILE..."

cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${PROJECT_DIR}/scraper.mjs</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>

    <key>StandardOutPath</key>
    <string>${PROJECT_DIR}/logs/launchd-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${PROJECT_DIR}/logs/launchd-stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
EOF

# Load the agent
echo "🚀 Loading launchd agent..."
launchctl load "$PLIST_FILE"

echo ""
echo "✅ SUCCESS! Substitute job scraper is now running as a persistent daemon."
echo ""
echo "🔄 The scraper checks for new jobs every 30 seconds."
echo "   If it crashes, launchd will restart it automatically."
echo "   Clean shutdown (Ctrl+C / SIGTERM) will NOT restart."
echo ""
echo "📋 Useful commands:"
echo "  • Check if running:     launchctl list | grep subjobs"
echo "  • View logs:            tail -f $PROJECT_DIR/logs/scraper.log"
echo "  • View launchd output:  tail -f $PROJECT_DIR/logs/launchd-stdout.log"
echo "  • View launchd errors:  tail -f $PROJECT_DIR/logs/launchd-stderr.log"
echo "  • Uninstall schedule:   pnpm run unschedule"
echo ""
echo "⏰ Active hours (scraper sleeps during off-hours, does not exit):"
echo "   - Every day (Monday - Sunday)"
echo "   - 5:00 AM - Midnight Mountain Time"
echo ""
