/**
 * Job Filtering Logic
 *
 * This module contains all the filtering rules for determining which substitute
 * teaching jobs to notify about. Filters are based on:
 * - School level (high school, junior high, middle school)
 * - Subject area (specific subjects to accept or reject)
 * - School blacklist (specific schools to avoid)
 * - Duration (only Full Day jobs)
 *
 * When Frontline updates or user preferences change, update these arrays.
 */

// ============================================================================
// SCHOOL LEVEL FILTERS
// ============================================================================

/**
 * School levels we want to accept (high school, junior high, middle school)
 * These patterns are matched against the school name (case-insensitive)
 */
export const ACCEPTED_SCHOOL_LEVELS = [
  'high school',
  'hs',
  'jr. high',
  'jr high',
  'junior high',
  'middle school',
  'intermediate',
];

/**
 * School levels we want to reject (elementary, primary, etc.)
 * If a school name contains any of these, immediately reject
 */
export const REJECTED_SCHOOL_LEVELS = [
  'elementary',
  'elem',
  'primary',
  'kindergarten',
  'pre-k',
  'preschool',
  'pre school',
];

/**
 * Specific schools to reject (blacklist)
 * If school name matches any of these, immediately reject
 */
export const REJECTED_SCHOOLS = [
  'westlake high school',
  'westlake hs',
  'saratoga springs',
  'vista heights middle school',
  'vista heights',
];

// ============================================================================
// SUBJECT FILTERS
// ============================================================================

/**
 * Subjects we want to accept
 * These patterns are matched against the position/subject field (case-insensitive)
 */
export const ACCEPTED_SUBJECTS = [
  // History / Social Sciences
  'history',
  'us history',
  'world history',
  'american history',
  'european history',
  'government',
  'geography',
  'economics',
  'sociology',
  'psychology',
  'social studies',
  'political science',
  'civics',

  // English / Language Arts (NEW)
  'english',
  'language arts',
  'ela',
  'literature',
  'writing',
  'composition',

  // Music (excluding choir/chorus)
  'band',
  'orchestra',
  'music',

  // Sciences
  'science',
  'biology',
  'chemistry',
  'physics',
  'earth science',
  'environmental science',
  'anatomy',
  'physiology',

  // Arts
  'art',
  'visual arts',
  'drawing',
  'painting',
  'ceramics',
  'drama',
  'theater',
  'theatre',
];

/**
 * Subjects we want to reject
 * If position contains any of these, reject the job
 */
export const REJECTED_SUBJECTS = [
  // Languages
  'spanish',
  'french',
  'german',
  'chinese',
  'japanese',
  'asl',
  'sign language',
  'esl',
  'ell',
  'english language learner',

  // Math and Computer Science
  'math',
  'mathematics',
  'algebra',
  'geometry',
  'calculus',
  'statistics',
  'computer science',
  'cs',
  'coding',
  'programming',

  // Choir (NEW)
  'choir',
  'chorus',
  'choral',

  // Other subjects to avoid
  'health',
  'pe',
  'physical education',
  'gym',
  'drivers ed',
  'driver education',
  'home economics',
  'special education',
  'sped',
];

// ============================================================================
// DURATION FILTERS
// ============================================================================

/**
 * Duration patterns we want to accept
 * Only accept "Full Day" jobs
 */
export const ACCEPTED_DURATIONS = [
  'full day',
  'full-day',
  'fullday',
];

/**
 * Duration patterns we want to reject
 * Reject any half-day or partial day jobs
 */
export const REJECTED_DURATIONS = [
  'half day',
  'half-day',
  'halfday',
  'half day am',
  'half day pm',
  'partial',
];

// ============================================================================
// FILTERING FUNCTIONS
// ============================================================================

/**
 * Check if a school level is accepted based on school name
 * @param {string} schoolName - The name of the school
 * @returns {boolean} true if school level is accepted
 */
export function isSchoolLevelAccepted(schoolName) {
  const lowerSchool = schoolName.toLowerCase();

  // First check if it matches any rejected school level patterns
  for (const rejected of REJECTED_SCHOOL_LEVELS) {
    if (lowerSchool.includes(rejected)) {
      return false;
    }
  }

  // Then check if it matches any accepted school level patterns
  for (const accepted of ACCEPTED_SCHOOL_LEVELS) {
    if (lowerSchool.includes(accepted)) {
      return true;
    }
  }

  // If no match on either list, return false (default to not accepting)
  return false;
}

/**
 * Check if a school is on the blacklist
 * @param {string} schoolName - The name of the school
 * @returns {boolean} true if school is blacklisted (should be rejected)
 */
export function isSchoolBlacklisted(schoolName) {
  const lowerSchool = schoolName.toLowerCase();

  for (const rejected of REJECTED_SCHOOLS) {
    if (lowerSchool.includes(rejected)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a subject is accepted
 * @param {string} position - The position/subject string
 * @returns {string} 'ACCEPT', 'REJECT', or 'UNCERTAIN'
 */
export function isSubjectAccepted(position) {
  const lowerPosition = position.toLowerCase();

  // First check rejected list - if it contains any rejected subject, immediately reject
  for (const rejected of REJECTED_SUBJECTS) {
    if (lowerPosition.includes(rejected)) {
      return 'REJECT';
    }
  }

  // Then check accepted list - if it contains any accepted subject, accept
  for (const accepted of ACCEPTED_SUBJECTS) {
    if (lowerPosition.includes(accepted)) {
      return 'ACCEPT';
    }
  }

  // If no match on either list, mark as uncertain
  return 'UNCERTAIN';
}

/**
 * Check if a duration is accepted (Full Day only)
 * @param {string} duration - The duration string
 * @returns {boolean} true if duration is accepted
 */
export function isDurationAccepted(duration) {
  const lowerDuration = duration.toLowerCase();

  // First check if it's explicitly rejected
  for (const rejected of REJECTED_DURATIONS) {
    if (lowerDuration.includes(rejected)) {
      return false;
    }
  }

  // Then check if it's explicitly accepted
  for (const accepted of ACCEPTED_DURATIONS) {
    if (lowerDuration.includes(accepted)) {
      return true;
    }
  }

  // If no match, default to rejecting (conservative approach)
  return false;
}

/**
 * Main filtering function - checks if a job matches all criteria
 * @param {Object} job - The job object with all fields
 * @returns {Object} { match: boolean, reason: string, uncertain: boolean }
 */
export function filterJob(job) {
  // 1. Check if school is blacklisted (highest priority check)
  if (isSchoolBlacklisted(job.school)) {
    return {
      match: false,
      reason: `School is blacklisted: ${job.school}`,
      uncertain: false,
    };
  }

  // 2. Check school level
  if (!isSchoolLevelAccepted(job.school)) {
    return {
      match: false,
      reason: `School level not accepted: ${job.school}`,
      uncertain: false,
    };
  }

  // 3. Check duration (Full Day only)
  if (!isDurationAccepted(job.duration)) {
    return {
      match: false,
      reason: `Duration not accepted (need Full Day): ${job.duration}`,
      uncertain: false,
    };
  }

  // 4. Check subject
  const subjectResult = isSubjectAccepted(job.position);

  if (subjectResult === 'REJECT') {
    return {
      match: false,
      reason: `Subject rejected: ${job.position}`,
      uncertain: false,
    };
  }

  if (subjectResult === 'ACCEPT') {
    return {
      match: true,
      reason: `All criteria met: ${job.school} - ${job.position} - ${job.duration}`,
      uncertain: false,
    };
  }

  // If subject is uncertain, accept but mark as uncertain
  return {
    match: true,
    reason: `Uncertain subject match: ${job.position} at ${job.school}`,
    uncertain: true,
  };
}
