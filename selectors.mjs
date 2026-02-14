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

    // Within each tbody.job, there are two rows: summary and detail
    summary: {
      row: 'tr.summary',
      teacherName: '.name',
      position: '.title',
      reportTo: '.reportToLocation',
      confirmationNumber: '.confNum',
    },

    detail: {
      row: 'tr.detail',
      date: '.itemDate',
      startTime: '.startTime',
      endTime: '.endTime',
      duration: '.durationName',
      location: '.locationName',
    }
  }
};
