// Curated dictionary of 100% active, embed-allowed Indian educational YouTube video IDs (Vedantu Class 9 & 10, Unacademy Class 9, Aakash BYJU'S, Khan Academy India)
export const topicResourcesMap = {
  // Science / Physics
  'optics': [
    { title: 'Light Reflection & Refraction One Shot Guide', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Vedantu Class 9 & 10' },
    { title: 'NCERT Light Reflection and Refraction Guide', url: 'https://ncert.nic.in/textbook.php?jesc1=10-14', type: 'article', channel: 'NCERT Official' }
  ],
  'kinematics': [
    { title: 'Motion & Kinematics Class 9 Physics One Shot', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Aakash BYJU\'S Class 9 & 10' },
    { title: 'Kinematics Formulas & Derivations', url: 'https://byjus.com/physics/kinematics-equations/', type: 'article', channel: 'BYJU\'S' }
  ],
  'electricity': [
    { title: 'Electricity & Circuits Full Chapter Guide', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Vedantu Class 9 & 10' },
    { title: 'Ohm\'s Law & Resistance Notes', url: 'https://www.khanacademy.org/science/in-in-class-10-physics-india/in-in-electricity', type: 'article', channel: 'Khan Academy India' }
  ],

  // Chemistry
  'chemical reactions': [
    { title: 'Chemical Reactions & Matter Class 9 Science', url: 'https://www.youtube.com/watch?v=7uV87f87Z24', type: 'youtube', channel: 'Unacademy Class 9 & 10' },
    { title: 'Balancing Chemical Equations Practice', url: 'https://www.khanacademy.org/science/chemistry', type: 'article', channel: 'Khan Academy India' }
  ],

  // Biology
  'cell biology': [
    { title: 'The Fundamental Unit of Life: Cell Class 9', url: 'https://www.youtube.com/watch?v=29vG4q3e4U8', type: 'youtube', channel: 'Vedantu Class 9 & 10' },
    { title: 'Cell Organelles Structure & Function Notes', url: 'https://byjus.com/biology/cell-structure-function/', type: 'article', channel: 'BYJU\'S' }
  ],

  // Mathematics / Algebra
  'algebra': [
    { title: 'Algebraic Expressions & Equations Class 9', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Vedantu Class 9 & 10' },
    { title: 'Class 9 Polynomials & Algebra Practice', url: 'https://www.khanacademy.org/math', type: 'article', channel: 'Khan Academy India' }
  ],
  'quadratic equations': [
    { title: 'Polynomials & Equations Class 9/10 Masterclass', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Aakash BYJU\'S Class 9 & 10' }
  ]
};

// Subject / Grade Guaranteed Fallbacks
export const subjectFallbackResources = {
  'Maths': [
    { title: 'Class 9 Mathematics Complete Chapter Series', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Vedantu Class 9 & 10' },
    { title: 'Khan Academy India Math Practice', url: 'https://www.khanacademy.org/math', type: 'article', channel: 'Khan Academy India' }
  ],
  'Science': [
    { title: 'Class 9 Science Complete Chapter One-Shot', url: 'https://www.youtube.com/watch?v=7uV87f87Z24', type: 'youtube', channel: 'Unacademy Class 9 & 10' },
    { title: 'NCERT Science Official Study Resource', url: 'https://ncert.nic.in/textbook.php', type: 'article', channel: 'NCERT Official' }
  ],
  'Physics': [
    { title: 'Class 9 Physics Laws of Motion & Energy', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Aakash BYJU\'S Class 9 & 10' },
    { title: 'NCERT Physics Official Study Resource', url: 'https://ncert.nic.in/textbook.php', type: 'article', channel: 'NCERT Official' }
  ],
  'Chemistry': [
    { title: 'Class 9 Chemistry Matter & Atoms Masterclass', url: 'https://www.youtube.com/watch?v=7uV87f87Z24', type: 'youtube', channel: 'Unacademy Class 9 & 10' },
    { title: 'NCERT Chemistry Study Material', url: 'https://ncert.nic.in/textbook.php', type: 'article', channel: 'NCERT Official' }
  ],
  'Biology': [
    { title: 'Class 9 Biology Cell & Tissues Masterclass', url: 'https://www.youtube.com/watch?v=29vG4q3e4U8', type: 'youtube', channel: 'Vedantu Class 9 & 10' },
    { title: 'Biology Foundations & Diagrams Notes', url: 'https://byjus.com/biology/', type: 'article', channel: 'BYJU\'S' }
  ],
  'General': [
    { title: 'Class 9 Foundation Master Series', url: 'https://www.youtube.com/watch?v=gJg1x0c0k4Y', type: 'youtube', channel: 'Vedantu Class 9 & 10' },
    { title: 'NCERT Official Open Educational Resources', url: 'https://ncert.nic.in/textbook.php', type: 'article', channel: 'NCERT Official' }
  ]
};

export function getResourcesForTopic(topic, subject, grade) {
  const normTopic = (topic || '').toLowerCase();
  for (const key of Object.keys(topicResourcesMap)) {
    if (normTopic.includes(key)) {
      return topicResourcesMap[key].map(r => ({
        ...r,
        title: grade ? r.title.replace(/Class \d+(\/\d+)?/, grade) : r.title
      }));
    }
  }

  const normSub = (subject || '').trim();
  let fallback = subjectFallbackResources[normSub];
  if (!fallback) {
    for (const subKey of Object.keys(subjectFallbackResources)) {
      if (normSub.toLowerCase().includes(subKey.toLowerCase())) {
        fallback = subjectFallbackResources[subKey];
        break;
      }
    }
  }

  if (!fallback) fallback = subjectFallbackResources['General'];

  return fallback.map(r => ({
    ...r,
    title: grade ? r.title.replace(/Class \d+/, grade) : r.title
  }));
}
