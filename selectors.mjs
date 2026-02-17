/**
 * DOM Selectors for Frontline Education
 *
 * These selectors are based on the actual HTML structure provided by the user.
 * If Frontline updates their UI, update these selectors and test with `pnpm run scrape`.
 */

export const SELECTORS = {
  login: {
    // Login page fields - Updated based on actual HTML
    usernameField: '#Username, input[name="Username"]',
    passwordField: '#Password, input[name="Password"]',
    submitButton: '#qa-button-login, button[type="submit"]:has-text("Sign In")',
  },

  popup: {
    // "Important Notifications" popup that may appear after login
    dialog: '.ui-dialog',
    dismissButton: '.ui-dialog-buttonset button:has-text("Dismiss")',
  },

  navigation: {
    // Tab navigation on the main page
    availableJobsTab: '#availableJobsTab',
    availableJobsPanel: '#availableJobs',
  },

  jobs: {
    // Job list structure in the Available Jobs tab
    jobListTable: '#availableJobs table.jobList',
    jobBodies: '#availableJobs tbody.job', // Each job is a tbody element
    noDataRow: 'tr.noData', // Shows "no available assignments" message when empty

    // Within each tbody.job, there are a summary row and one or more detail rows
    summary: {
      row: 'tr.summary',
      teacherName: '.name',
      position: '.title',
      reportTo: '.reportToLocation',
      confirmationNumber: '.confNum',
    },

    detail: {
      row: 'tr.detail',           // First detail row (all jobs have this)
      allRows: 'tr.detail',       // All detail rows (multi-day jobs have multiple)
      date: '.itemDate',
      multiEndDate: '.multiEndDate', // End date for multi-day jobs (e.g., "Fri, 2/20/2026")
      startTime: '.startTime',
      endTime: '.endTime',
      duration: '.durationName',
      location: '.locationName',
    },

    // Multi-day job detection
    // Multi-day jobs have tbody.job.multiday class
    // Collapsed: tbody.job.multiday.collapsed (shows "See Details" button)
    // Expanded: tbody.job.multiday.expanded (shows "Accept Multi-day" + "Hide Details")
    multiDay: {
      jobBody: 'tbody.job.multiday',         // Multi-day job tbody
      additionalRows: 'tr.detail.multiDetail', // Extra detail rows (2nd, 3rd day, etc.)
    },

    // Job card action buttons (for future auto-booking)
    // Single-day: click acceptButton directly
    // Multi-day: click seeDetailsButton first, then acceptButton (shows "Accept Multi-day")
    actions: {
      acceptButton: 'a.acceptButton',
      rejectButton: 'a.rejectButton',
      seeDetailsButton: 'a.showDetailsButton',
      hideDetailsButton: 'a.hideDetailsButton',
      cancelButton: 'a.cancelButton',
    },
  }
};
