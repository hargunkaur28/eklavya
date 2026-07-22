// Track 4.1: this is the DISPLAY (en/hi) layer only. The canonical subject list
// itself lives in ../data/taxonomy.js (SUBJECTS) — the keys here must cover it
// (plus 'General', which is a runtime fallback, not a selectable subject). A test
// guards that every canonical subject has en + hi names here.
export const subjectNames = {
  en: {
    Maths: 'Maths',
    Science: 'Science',
    Physics: 'Physics',
    Chemistry: 'Chemistry',
    Biology: 'Biology',
    JEE: 'JEE',
    NEET: 'NEET',
    English: 'English',
    Hindi: 'Hindi',
    'Social Science': 'Social Science',
    General: 'General'
  },
  hi: {
    Maths: 'गणित',
    Science: 'विज्ञान',
    Physics: 'भौतिक विज्ञान',
    Chemistry: 'रसायन विज्ञान',
    Biology: 'जीव विज्ञान',
    JEE: 'JEE',
    NEET: 'NEET',
    English: 'अंग्रेजी',
    Hindi: 'हिंदी',
    'Social Science': 'सामाजिक विज्ञान',
    General: 'सामान्य'
  }
};

export const gradeNames = {
  en: {
    Nursery: 'Nursery',
    KG: 'KG'
  },
  hi: {
    Nursery: 'नर्सरी',
    KG: 'केजी'
  }
};

// Track (subject-splitting): display names for the sub-subjects. Keys are the exact
// canonical sub-subject strings from taxonomy.js's SUB_SUBJECTS. Physics/Chemistry/
// Biology reuse the same Hindi as their flat-subject counterparts for consistency.
export const subSubjectNames = {
  en: {
    Writing: 'Writing', Grammar: 'Grammar', Reading: 'Reading', Fusion: 'Fusion',
    Physics: 'Physics', Chemistry: 'Chemistry', Biology: 'Biology', Combined: 'Combined',
    Economics: 'Economics', Civics: 'Civics', Geography: 'Geography', History: 'History'
  },
  hi: {
    Writing: 'लेखन', Grammar: 'व्याकरण', Reading: 'पठन', Fusion: 'संयुक्त',
    Physics: 'भौतिक विज्ञान', Chemistry: 'रसायन विज्ञान', Biology: 'जीव विज्ञान', Combined: 'संयुक्त',
    Economics: 'अर्थशास्त्र', Civics: 'नागरिक शास्त्र', Geography: 'भूगोल', History: 'इतिहास'
  }
};

export function getSubSubjectName(subSubject, language = 'en') {
  if (!subSubject) return '';
  return subSubjectNames[language]?.[subSubject] || subSubject;
}

// `subSubject` is OPTIONAL (4th arg, after language) so existing 3-arg callers are
// unaffected; when present it's appended as " · <SubSubject>" (e.g. "Class 10 — English · Grammar").
export function formatGradeSubject(grade, subject, language = 'en', subSubject = '') {
  if (!grade && !subject) return '';
  let normSub = subjectNames[language]?.[subject] || subject || '';
  if (subSubject) normSub = `${normSub} · ${getSubSubjectName(subSubject, language)}`;
  let normGrade = grade || '';

  if (language === 'hi' && normGrade && normGrade.toLowerCase().startsWith('class ')) {
    normGrade = normGrade.replace(/class /i, 'कक्षा ');
  } else if (language === 'hi' && gradeNames.hi[normGrade]) {
    normGrade = gradeNames.hi[normGrade];
  }

  if (normGrade && normSub) {
    return `${normGrade} • ${normSub}`;
  }
  return normGrade || normSub;
}

export function formatGradeSubjectDash(grade, subject, language = 'en', subSubject = '') {
  if (!grade && !subject) return '';
  let normSub = subjectNames[language]?.[subject] || subject || '';
  if (subSubject) normSub = `${normSub} · ${getSubSubjectName(subSubject, language)}`;
  let normGrade = grade || '';

  if (language === 'hi' && normGrade && normGrade.toLowerCase().startsWith('class ')) {
    normGrade = normGrade.replace(/class /i, 'कक्षा ');
  } else if (language === 'hi' && gradeNames.hi[normGrade]) {
    normGrade = gradeNames.hi[normGrade];
  }

  if (normGrade && normSub) {
    return `${normGrade} — ${normSub}`;
  }
  return normGrade || normSub;
}
