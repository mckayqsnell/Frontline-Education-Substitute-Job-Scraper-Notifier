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
 * Full day + accepted subject at blacklisted schools = uncertain (not rejected)
 * Half days at blacklisted schools are still fully rejected.
 */
export const BLACKLISTED_SCHOOLS = [
  'westlake high school',
  'westlake hs',
  'saratoga springs',
  'vista heights middle school',
  'vista heights',
];

/**
 * Schools considered "nearby" to Orem, UT.
 * Half day + accepted subject at these schools = uncertain match.
 * Half days at schools NOT on this list are fully rejected.
 *
 * Cities included: Orem, Lindon, Pleasant Grove, Vineyard,
 *   American Fork, Cedar Hills, Highland, Alpine, Lehi
 */
export const NEARBY_SCHOOLS = [
  'orem',
  'lindon',
  'pleasant grove',
  'vineyard',
  'american fork',
  'cedar hills',
  'highland',
  'alpine',
  'lehi',
  // Specific school names that may not contain city name
  'mountain view',     // Mountain View HS — Orem
  'timpanogos',        // Timpanogos HS — Orem
  'canyon view',       // Canyon View JH — Orem
  'lone peak',         // Lone Peak HS — Highland
  'skyridge',          // Skyridge HS — Lehi
  'timberline',        // Timberline MS — Alpine
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
  'government',
  'geography',
  'econ',        // matches "econ", "economics", "home economics", etc.
  'sociology',
  'psychology',
  'social studies',
  'political science',
  'civics',
  'humanities',

  // English / Language Arts
  'english',
  'language arts',
  'ela',
  'literature',
  'writing',
  'composition',
  'reading',

  // Music (excluding choir/chorus)
  'band',
  'orchestra',
  'music',

  // Math
  'math',       // matches "math", "mathematics", etc.
  'algebra',
  'geometry',
  'calculus',
  'statistics',

  // Sciences
  'science',
  'biology',
  'chemistry',
  'physics',
  'anatomy',
  'physiology',

  // CTE (Career and Technical Education)
  'cte',
  'career and technical',
  'career tech',

  // Arts
  'art',
  'visual arts',
  'drawing',
  'painting',
  'ceramics',
  'drama',
  'theater',
  'theatre',
  'performing arts',
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
  'sign language',
  'english language learner',

  // Computer Science
  'computer science',
  'coding',
  'programming',

  // Choir
  'choir',
  'chorus',
  'choral',

  // Other subjects to avoid
  'physical education',
  'gym',
  'drivers ed',
  'driver education',
  'special education',
  'special ed',
  'sped',

  // NOTE: Removed short abbreviations that caused false rejections:
  // "cs" → matched inside "physics", "economics"
  // "pe" → matched inside "performing", "special"
  // "ell" → matched inside "spelling"
  // "asl", "esl" → removed (too short, could match substrings)
  // The full forms above cover these cases adequately.
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
 * @returns {boolean} true if school is blacklisted
 */
export function isSchoolBlacklisted(schoolName) {
  const lowerSchool = schoolName.toLowerCase();

  for (const rejected of BLACKLISTED_SCHOOLS) {
    if (lowerSchool.includes(rejected)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a school is near Orem, UT (for half-day uncertain matching)
 * @param {string} schoolName - The name of the school
 * @returns {boolean} true if school is nearby
 */
export function isSchoolNearby(schoolName) {
  const lowerSchool = schoolName.toLowerCase();

  for (const nearby of NEARBY_SCHOOLS) {
    if (lowerSchool.includes(nearby)) {
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
 *
 * Matching rules:
 *   - Accepted school level + accepted subject + full day = CERTAIN match
 *   - Accepted school level + uncertain subject + full day = UNCERTAIN match
 *   - Blacklisted school + accepted subject + full day = UNCERTAIN match
 *   - Nearby school + accepted subject + half day = UNCERTAIN match
 *   - Everything else = rejected
 *
 * @param {Object} job - The job object with all fields
 * @returns {Object} { match: boolean, reason: string, uncertain: boolean }
 */
export function filterJob(job) {
  const blacklisted = isSchoolBlacklisted(job.school);
  const schoolLevelOk = isSchoolLevelAccepted(job.school);
  const fullDay = isDurationAccepted(job.duration);
  const subjectResult = isSubjectAccepted(job.position);
  const nearby = isSchoolNearby(job.school);

  // Always reject if subject is on the rejected list
  if (subjectResult === 'REJECT') {
    return { match: false, reason: `Subject rejected: ${job.position}`, uncertain: false };
  }

  // Always reject schools that aren't the right level (unless blacklisted — they have their own path)
  if (!schoolLevelOk && !blacklisted) {
    return { match: false, reason: `School level not accepted: ${job.school}`, uncertain: false };
  }

  // --- Blacklisted schools ---
  if (blacklisted) {
    // Blacklisted + full day + accepted/uncertain subject = uncertain match
    if (fullDay && (subjectResult === 'ACCEPT' || subjectResult === 'UNCERTAIN')) {
      return {
        match: true,
        reason: `Blacklisted school (uncertain): ${job.school} - ${job.position}`,
        uncertain: true,
      };
    }
    // Blacklisted + half day = rejected
    return { match: false, reason: `Blacklisted school: ${job.school}`, uncertain: false };
  }

  // --- Full day at accepted school level ---
  if (fullDay) {
    if (subjectResult === 'ACCEPT') {
      return {
        match: true,
        reason: `All criteria met: ${job.school} - ${job.position} - ${job.duration}`,
        uncertain: false,
      };
    }
    // Uncertain subject
    return {
      match: true,
      reason: `Uncertain subject match: ${job.position} at ${job.school}`,
      uncertain: true,
    };
  }

  // --- Half day at accepted school level ---
  // Half day + nearby school + accepted subject = uncertain
  if (nearby && subjectResult === 'ACCEPT') {
    return {
      match: true,
      reason: `Half day nearby (uncertain): ${job.school} - ${job.position} - ${job.duration}`,
      uncertain: true,
    };
  }

  // Half day + far school OR half day + uncertain subject = rejected
  return {
    match: false,
    reason: `Half day ${nearby ? 'uncertain subject' : 'not nearby'}: ${job.school} - ${job.duration}`,
    uncertain: false,
  };
}
