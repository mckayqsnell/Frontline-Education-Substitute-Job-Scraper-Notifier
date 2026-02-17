#!/usr/bin/env bash

#######################################################
# Install launchd Schedule for Substitute Job Scraper
#######################################################
#
# This script creates and loads a launchd agent that runs
# the scraper every 5 minutes (24/7).
#
# The scraper itself checks operating hours (5 AM - 11 PM MT, every day)
# and exits immediately if outside those hours.
#
# Usage: pnpm run schedule
#

set -e  # Exit on error

PLIST_LABEL="com.subjobs.scraper"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
PROJECT_DIR="/Users/mckaysnell/personal_projects/sub_teacher_scaper"
NODE_PATH="/Users/mckaysnell/.nvm/versions/node/v22.14.0/bin/node"

echo "📦 Installing launchd schedule for substitute job scraper..."
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

    <key>StartInterval</key>
    <integer>300</integer>

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
    <false/>

    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF

# Load the agent
echo "🚀 Loading launchd agent..."
launchctl load "$PLIST_FILE"

echo ""
echo "✅ SUCCESS! Substitute job scraper is now scheduled to run every 5 minutes."
echo ""
echo "📋 Useful commands:"
echo "  • Check if running:     launchctl list | grep subjobs"
echo "  • View logs:            tail -f $PROJECT_DIR/logs/scraper.log"
echo "  • View launchd output:  tail -f $PROJECT_DIR/logs/launchd-stdout.log"
echo "  • View launchd errors:  tail -f $PROJECT_DIR/logs/launchd-stderr.log"
echo "  • Uninstall schedule:   pnpm run unschedule"
echo ""
echo "⏰ Active hours (scraper exits immediately if outside these hours):"
echo "   - Every day (Monday - Sunday)"
echo "   - 5:00 AM - 11:00 PM Mountain Time"
echo ""
echo "💡 Note: launchd runs the scraper every 5 minutes (24/7), but the scraper"
echo "   checks the time and exits early if outside active hours."
echo ""
