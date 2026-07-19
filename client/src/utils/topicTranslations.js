export const topicNames = {
  en: {
    Algebra: 'Algebra',
    Geometry: 'Geometry',
    Trigonometry: 'Trigonometry',
    Calculus: 'Calculus',
    Probability: 'Probability',
    'Percentage Change': 'Percentage Change',
    'Chemical Reactions': 'Chemical Reactions',
    'Acids & Bases': 'Acids & Bases',
    'Life Processes': 'Life Processes',
    Electricity: 'Electricity',
    'Light & Optics': 'Light & Optics',
    Digestion: 'Digestion',
    'Units & Dimensions': 'Units & Dimensions',
    Kinematics: 'Kinematics',
    'Projectile Motion': 'Projectile Motion',
    'Quadratic Equations': 'Quadratic Equations',
    'Work & Energy': 'Work & Energy',
    'Cell Biology': 'Cell Biology',
    Photosynthesis: 'Photosynthesis',
    Genetics: 'Genetics',
    'Human Physiology': 'Human Physiology',
    'Enzymes & Digestion': 'Enzymes & Digestion',
    Ecology: 'Ecology',
    General: 'General'
  },
  hi: {
    Algebra: 'बीजगणित',
    Geometry: 'ज्यामिति',
    Trigonometry: 'त्रिकोणमिति',
    Calculus: 'कलन',
    Probability: 'प्रायिकता',
    'Percentage Change': 'प्रतिशत परिवर्तन',
    'Chemical Reactions': 'रासायनिक अभिक्रियाएं',
    'Acids & Bases': 'अम्ल और क्षार',
    'Life Processes': 'जैव प्रक्रम',
    Electricity: 'विद्युत',
    'Light & Optics': 'प्रकाश एवं प्रकाशिकी',
    Digestion: 'पाचन',
    'Units & Dimensions': 'मात्रक और विमाएं',
    Kinematics: 'गतिकी',
    'Projectile Motion': 'प्रक्षेप्य गति',
    'Quadratic Equations': 'द्विघात समीकरण',
    'Work & Energy': 'कार्य और ऊर्जा',
    'Cell Biology': 'कोशिका विज्ञान',
    Photosynthesis: 'प्रकाश संश्लेषण',
    Genetics: 'आनुवंशिकी',
    'Human Physiology': 'मानव शरीर विज्ञान',
    'Enzymes & Digestion': 'एंजाइम और पाचन',
    Ecology: 'पारिस्थितिकी',
    General: 'सामान्य'
  }
};

export function getTranslatedTopic(topic, language = 'en') {
  if (!topic || typeof topic !== 'string') return topic || '';
  return topicNames[language]?.[topic] || topic;
}
