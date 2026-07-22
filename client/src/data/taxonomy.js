// Track 4.1: the single client-side source of truth for the subject + grade
// taxonomy (previously the hardcoded SUBJECTLIST/GRADELIST inside Onboarding.jsx).
// MUST stay byte-identical to server/src/config/taxonomy.js — a drift test guards
// this. 4.1 is cleanup only: the values are the EXACT prior set, order preserved
// (the arrays drive the onboarding dropdowns), nothing added/removed.

export const SUBJECTS = [
  'Science', 'Maths', 'Physics', 'Chemistry', 'Biology',
  'JEE', 'NEET', 'English', 'Hindi', 'Social Science'
];

export const GRADES = [
  'Nursery', 'KG', 'Class 1', 'Class 2', 'Class 3', 'Class 4',
  'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
  'Class 11', 'Class 12'
];
