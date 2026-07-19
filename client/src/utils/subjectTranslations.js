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

export function formatGradeSubject(grade, subject, language = 'en') {
  if (!grade && !subject) return '';
  const normSub = subjectNames[language]?.[subject] || subject || '';
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

export function formatGradeSubjectDash(grade, subject, language = 'en') {
  if (!grade && !subject) return '';
  const normSub = subjectNames[language]?.[subject] || subject || '';
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
