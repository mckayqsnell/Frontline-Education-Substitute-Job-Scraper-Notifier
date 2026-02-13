#!/usr/bin/env bash

#########################################################
# Uninstall launchd Schedule for Substitute Job Scraper
#########################################################
#
# This script unloads and removes the launchd agent for the scraper.
#
# Usage: pnpm run unschedule
#

set -e  # Exit on error

PLIST_LABEL="com.subjobs.scraper"
PLIST_FILE="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "🗑️  Uninstalling launchd schedule for substitute job scraper..."
echo ""

# Check if plist file exists
if [ ! -f "$PLIST_FILE" ]; then
  echo "⚠️  Warning: Plist file not found at $PLIST_FILE"
  echo "The schedule may not have been installed, or it was already removed."
  exit 0
fi

# Unload the agent if it's running
if launchctl list | grep -q "$PLIST_LABEL"; then
  echo "🛑 Unloading launchd agent..."
  launchctl unload "$PLIST_FILE"
else
  echo "ℹ️  Agent not currently loaded (not running)"
fi

# Remove the plist file
echo "🗑️  Removing plist file..."
rm "$PLIST_FILE"

echo ""
echo "✅ SUCCESS! Launchd schedule has been removed."
echo ""
echo "The scraper will no longer run automatically."
echo "To reinstall, run: pnpm run schedule"
echo ""
