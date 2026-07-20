export const translations = {
  en: {
    brand: 'Project Eklavya',
    brandName: 'EKLAVYA',
    brandSubheading: 'Ek Shikshak, Har Vidhyarthi',
    // Header / Nav
    nav: {
      home: 'Home',
      courses: 'Courses',
      mentors: 'Mentors',
      successStories: 'Success Stories',
      pricing: 'Pricing',
      about: 'About'
    },
    header: {
      login: 'Log In',
      getStarted: 'Get Started',
      langToggleLabel: 'Switch to Hindi',
      dashboard: 'Dashboard',
      logout: 'Log Out'
    },

    auth: {
      tagline: 'AI-Powered Learning for Bharat',
      loginTab: 'Log In',
      createAccountTab: 'Create Account',
      fullName: 'Full Name',
      fullNamePlaceholder: 'e.g. Ananya Sharma',
      emailAddress: 'Email Address',
      password: 'Password',
      processing: 'Processing...',
      loginSubmit: 'Log In to Account',
      signupSubmit: 'Start Learning Free',
      rememberMe: 'Remember me (keep me logged in for 90 days)'
    },

    // Dashboard
    dashboard: {
      greeting: (name) => `Hello, ${name}`,
      studentCommandCenter: 'Student Command Center',
      retakeTest: 'Retake Test',
      studyRoadmap: 'Study Roadmap',
      diagnosticReview: 'Diagnostic Review',
      yourRoadmapProgress: 'Your Roadmap Progress',
      daysCompleted: (done, total) => `${done} of ${total} days completed`,
      day: (num) => `Day ${num}`,
      mins: (m) => `${m} mins`,
      tailoredScheduleSubtitle: 'Tailored learning schedule based on your diagnostic assessment results.',
      noRoadmapFound: 'No active study roadmap found',
      noRoadmapSubtitle: 'Complete your diagnostic test to build your personalized AI roadmap.',
      startDiagnostic: 'Start Onboarding Diagnostic',
      translatingRoadmap: 'Translating study roadmap to Hindi via Sarvam Translate API...',
      viewYoutubeResource: 'View YouTube Resource',
      diagnosticAssessmentResults: 'Diagnostic Assessment Results',
      aiRecommendation: 'AI Diagnostic Recommendation',
      questionBreakdown: 'Diagnostic Question Breakdown',
      question: (num) => `Question ${num}`,
      correct: 'Correct',
      incorrect: 'Incorrect',
      yourAnswer: 'Your Answer',
      correctAnswer: 'Correct Answer',
      explanation: 'Explanation:',
      noReviewAvailable: 'No Diagnostic Review Available',
      noReviewSubtitle: 'This roadmap was created prior to detailed diagnostic review tracking. You can retake your diagnostic test anytime.',
      retakeDiagnosticTest: 'Retake Diagnostic Test',
      score: (pct) => `Score (${pct}%)`
    },

    // Day Detail
    dayDetail: {
      loading: 'Loading day module...',
      unavailable: 'Day Module Unavailable',
      couldNotLoad: 'Could not load day detail.',
      backToRoadmap: 'Back to Roadmap',
      completed: 'Completed',
      markComplete: 'Mark as Complete',
      overviewKeyConcepts: 'Module Overview & Key Concepts',
      verifiedResources: 'Verified Study Resources',
      videoGuide: 'Video Guide',
      officialGuide: 'Official Guide',
      readArticle: 'Read Article',
      noResourcesFound: 'No video resources found for this topic yet — try refreshing later.'
    },

    // Diagnostic Review Page
    review: {
      loading: 'Loading diagnostic review...',
      unavailable: 'Diagnostic Review Unavailable',
      notFound: 'Review data could not be found.',
      returnToOnboarding: 'Return to Onboarding',
      testReview: 'Diagnostic Test Review',
      assessment: 'Assessment',
      translatingBreakdown: 'Translating review breakdown to Hindi via Sarvam Translate API...',
      topicStrengthBreakdown: 'Topic Strength Breakdown',
      detailedAnalysis: 'Question-by-Question Detailed Analysis',
      generatingRoadmap: 'Generating AI Study Roadmap...',
      generateMyRoadmap: 'Generate My Study Roadmap'
    },

    // Hero
    hero: {
      badge1: 'Nursery to 12th',
      badgeJee: 'JEE',
      badgeNeet: 'NEET',
      titleLine1: 'AI-Powered learning that',
      titleHighlight: 'grows',
      titleLine2: 'with every student.',
      description: 'Complete learning support for school academics from Nursery to Grade 12, plus JEE and NEET preparation through real YouTube course pathways, quizzes and progress-ready content.',
      ctaPrimary: 'Start Learning Free',
      ctaSecondary: 'Explore Courses',
      studentCount: '50K+',
      studentCountLabel: 'Students learning with us',
      featureLive: 'Live Classes',
      featureLiveDesc: 'Learn in real time',
      featureMentors: 'AI Expert Mentors',
      featureMentorsDesc: 'AI supported doubt help',
      featureMock: 'AI Mock Tests',
      featureMockDesc: 'Adaptive practice & scoring',
      featureProgress: 'AI Progress Tracking',
      featureProgressDesc: 'Data-driven insights',
      featureAi: 'AI Learning Tool',
      featureAiDesc: 'Smart day-by-day topic search',
      featureTrans: 'Hindi Translation',
      featureTransDesc: 'Seamlessly switch to learn in Hindi',
      featureSpeech: 'Text to Speech',
      featureSpeechDesc: 'Listen to content with voice recognition'
    },

    // Stats
    stats: {
      courses: 'Real YouTube Courses',
      quizQuestions: 'Quiz Questions',
      videoLessons: 'Video Lessons',
      classesCovered: 'Classes Covered'
    },

    // Why Choose
    whyChoose: {
      kicker: 'Why Choose Project Eklavya',
      headingPart1: 'Everything a student needs in one place,',
      headingHighlight: 'supercharged by AI',
      intro: 'Discover AI-powered tools and guidance that make learning more focused, trackable and enjoyable.',
      card1Title: 'Structured Pathways',
      card1Text: 'Step-by-step learning journeys aligned with school curriculum, JEE and NEET preparation.',
      card2Title: 'Premium Mentorship',
      card2Text: 'Get personalized guidance, live doubt support and expert mentorship whenever you need it.',
      card3Title: 'Deep Analytics',
      card3Text: 'Track learning progress, quiz performance and strengths with simple, actionable insights.',
      card4Title: 'Smart Learning',
      card4Text: 'Access video lessons, notes, quizzes and practice tests from one unified platform.',
      card5Title: 'Practice & Assess',
      card5Text: 'Strengthen concepts through chapter-wise quizzes, mock tests and instant performance feedback.',
      card6Title: 'Achieve & Excel',
      card6Text: 'Designed for Nursery to 12th, JEE, NEET and competitive exam preparation.',
      card7Title: 'AI-Powered Learning',
      card7Text: 'Learn smarter with an AI tutor that adapts to your pace and learning needs.',
      card8Title: 'Hindi Translation',
      card8Text: 'Understand every lesson in Hindi with seamless translation across the platform.',
      card9Title: 'Text to Speech',
      card9Text: 'Listen to lessons and study materials with natural, AI-powered voice narration.'
    },

    // Courses section
    courses: {
      kicker: 'Our Courses',
      heading: 'Signature Curriculums',
      description: 'Real YouTube-based course pathways for Indian school and entrance exam learners.',
      viewAll: 'View all courses',
      learnMore: 'Learn More'
    },

    // Testimonials
    testimonials: {
      kicker: 'Testimonials',
      heading: 'What our students say',
      card1Name: 'Ananya Sharma',
      card1Label: 'Class 10 Student',
      card1Text: 'The course path helped me revise Science chapters with questions after every lesson.',
      card2Name: 'Rohan Mehta',
      card2Label: 'JEE Aspirant',
      card2Text: 'Seeing my quiz score right after practice made weak chapters very clear before mocks.',
      card3Name: 'Neha Patil',
      card3Label: 'NEET Aspirant',
      card3Text: 'Biology quizzes here are highly NCERT-oriented. The explanations are extremely clear.',
      card4Name: 'Aarav Gupta',
      card4Label: 'Class 12 Board',
      card4Text: 'Best way to revise Physics derivations and try mock tests. 100% recommended!',
      card5Name: 'Aditya Kumar',
      card5Label: 'JEE 2026',
      card5Text: 'Simple interface, no clutter, and directly linked to top teacher playlists. Saved me hours.',
      card6Name: 'Pooja Iyer',
      card6Label: 'Class 10 Board',
      card6Text: 'Found the math foundations super easy to follow. The progress tracking keeps me motivated.'
    },

    // CTA
    cta: {
      heading: 'Ready to start AI-powered learning?',
      description: 'Join learners preparing for school exams, JEE and NEET with focused video courses and quizzes.',
      button: 'Apply for Membership'
    },

    // Footer
    footer: {
      tagline: 'Frontend-only AI-powered Project Eklavya demo for Indian K-12, JEE and NEET learners.',
      product: 'Product',
      productCourses: 'Courses',
      productQuizzes: 'Quizzes',
      productPricing: 'Pricing',
      company: 'Company',
      companyAbout: 'About',
      companyStories: 'Success Stories',
      companyContact: 'Contact Us',
      support: 'Support',
      supportHelp: 'Help Center',
      supportPrivacy: 'Privacy Policy',
      supportTerms: 'Terms of Service'
    },

    // Course Detail
    courseDetail: {
      backToCourses: 'Back to courses',
      youtubeLabel: 'YouTube Course',
      openOnYoutube: 'Open on YouTube',
      learningPath: 'Learning Path',
      backendNote: 'Backend-ready scope',
      backendNoteDesc: 'Course, quiz, answer and progress objects are isolated in data structures so APIs can replace them later.',
      quizKicker: 'Real Practice Quiz',
      attempted: 'attempted',
      explanation: 'Explanation'
    },

    // AI Roadmap
    aiRoadmap: {
      title: 'AI Powered Learning in 2026:',
      subtitle: 'A Step-by-Step Guide to Smarter Learning',
      step1: 'Set your learning goals',
      step2: 'Smart day-by-day topic search',
      step3: 'Personalized study modules',
      step4: 'Seamlessly switch to Hindi',
      step5: 'Learn in your preferred language',
      step6: 'Listen with voice recognition',
      step7: 'Track your growth with AI'
    },

    // AI For Learning (Bharat section)
    aiForLearning: {
      kicker: 'AI For Bharat',
      heading: 'AI that speaks your child\'s language — literally',
      subheading: 'Built for students in rural and small-town India, Project Eklavya uses homegrown Indian AI to teach, tutor, and explain — in the language your child understands best.',
      card1Title: 'Sarvam AI',
      card1Text: 'India\'s own AI models that understand and speak Hindi, Tamil, Telugu, Bengali, and more — so every child can learn by speaking, not just typing.',
      card2Title: 'Built for Bharat',
      card2Text: 'Designed around Indian syllabi, Indian accents, and real rural classroom needs — not imported from Silicon Valley.',
      card3Title: 'AI Tutor',
      card3Text: 'A patient AI tutor that explains concepts again and again in your child\'s own language, at their own pace — no private tuition needed.',
      card4Title: 'AI Notes & PDFs',
      card4Text: 'AI-generated notes and PDFs in the student\'s language — download once, print locally, and study offline anytime.'
    }
  },

  hi: {
    brand: 'प्रोजेक्ट एकलव्य',
    brandName: 'एकलव्य',
    brandSubheading: 'एक शिक्षक, हर विद्यार्थी',
    // Header / Nav
    nav: {
      home: 'होम',
      courses: 'कोर्स',
      mentors: 'मेंटर्स',
      successStories: 'सफलता की कहानियाँ',
      pricing: 'मूल्य',
      about: 'हमारे बारे में'
    },
    header: {
      login: 'लॉग इन',
      getStarted: 'शुरू करें',
      langToggleLabel: 'Switch to English',
      dashboard: 'डैशबोर्ड',
      logout: 'लॉग आउट'
    },

    auth: {
      tagline: 'भारत के लिए AI-संचालित शिक्षा',
      loginTab: 'लॉग इन',
      createAccountTab: 'खाता बनाएं',
      fullName: 'पूरा नाम',
      fullNamePlaceholder: 'उदा. अनन्या शर्मा',
      emailAddress: 'ईमेल पता',
      password: 'पासवर्ड',
      processing: 'प्रोसेस हो रहा है...',
      loginSubmit: 'खाते में लॉग इन करें',
      signupSubmit: 'निःशुल्क सीखना शुरू करें',
      rememberMe: 'मुझे याद रखें (90 दिनों तक लॉग इन रखें)'
    },

    // Dashboard
    dashboard: {
      greeting: (name) => `नमस्ते, ${name}`,
      studentCommandCenter: 'छात्र कमांड सेंटर',
      retakeTest: 'फिर से टेस्ट लें',
      studyRoadmap: 'अध्ययन रोडमैप',
      diagnosticReview: 'डायग्नोस्टिक समीक्षा',
      yourRoadmapProgress: 'आपकी रोडमैप प्रगति',
      daysCompleted: (done, total) => `${total} में से ${done} दिन पूरे`,
      day: (num) => `दिन ${num}`,
      mins: (m) => `${m} मिनट`,
      tailoredScheduleSubtitle: 'आपके डायग्नोस्टिक मूल्यांकन परिणामों के आधार पर तैयार अध्ययन कार्यक्रम।',
      noRoadmapFound: 'कोई सक्रिय अध्ययन रोडमैप नहीं मिला',
      noRoadmapSubtitle: 'अपना व्यक्तिगत AI रोडमैप बनाने के लिए डायग्नोस्टिक टेस्ट पूरा करें।',
      startDiagnostic: 'ऑनबोर्डिंग डायग्नोस्टिक शुरू करें',
      translatingRoadmap: 'सर्वम ट्रांसलेट API के माध्यम से अध्ययन रोडमैप का हिंदी में अनुवाद किया जा रहा है...',
      viewYoutubeResource: 'YouTube संसाधन देखें',
      diagnosticAssessmentResults: 'डायग्नोस्टिक मूल्यांकन परिणाम',
      aiRecommendation: 'AI डायग्नोस्टिक सिफारिश',
      questionBreakdown: 'डायग्नोस्टिक प्रश्न विश्लेषण',
      question: (num) => `प्रश्न ${num}`,
      correct: 'सही',
      incorrect: 'गलत',
      yourAnswer: 'आपका उत्तर',
      correctAnswer: 'सही उत्तर',
      explanation: 'व्याख्या:',
      noReviewAvailable: 'कोई डायग्नोस्टिक समीक्षा उपलब्ध नहीं है',
      noReviewSubtitle: 'यह रोडमैप विस्तृत डायग्नोस्टिक समीक्षा ट्रैकिंग से पहले बनाया गया था। आप किसी भी समय अपना डायग्नोस्टिक टेस्ट फिर से ले सकते हैं।',
      retakeDiagnosticTest: 'फिर से डायग्नोस्टिक टेस्ट लें',
      score: (pct) => `अंक (${pct}%)`
    },

    // Day Detail
    dayDetail: {
      loading: 'दिन का मॉड्यूल लोड हो रहा है...',
      unavailable: 'दिन का मॉड्यूल उपलब्ध नहीं है',
      couldNotLoad: 'दिन का विवरण लोड नहीं किया जा सका।',
      backToRoadmap: 'रोडमैप पर वापस जाएँ',
      completed: 'पूर्ण',
      markComplete: 'पूर्ण के रूप में चिह्नित करें',
      overviewKeyConcepts: 'मॉड्यूल अवलोकन और मुख्य अवधारणाएं',
      verifiedResources: 'सत्यापित अध्ययन संसाधन',
      videoGuide: 'वीडियो गाइड',
      officialGuide: 'आधिकारिक गाइड',
      readArticle: 'लेख पढ़ें',
      noResourcesFound: 'इस विषय के लिए अभी कोई वीडियो संसाधन नहीं मिले — बाद में ताज़ा करने का प्रयास करें।'
    },

    // Diagnostic Review Page
    review: {
      loading: 'डायग्नोस्टिक समीक्षा लोड हो रही है...',
      unavailable: 'डायग्नोस्टिक समीक्षा उपलब्ध नहीं है',
      notFound: 'समीक्षा डेटा नहीं मिला।',
      returnToOnboarding: 'ऑनबोर्डिंग पर वापस जाएँ',
      testReview: 'डायग्नोस्टिक टेस्ट समीक्षा',
      assessment: 'मूल्यांकन',
      translatingBreakdown: 'सर्वम ट्रांसलेट API के माध्यम से समीक्षा का हिंदी में अनुवाद किया जा रहा है...',
      topicStrengthBreakdown: 'विषय क्षमता विश्लेषण',
      detailedAnalysis: 'प्रश्न-दर-प्रश्न विस्तृत विश्लेषण',
      generatingRoadmap: 'AI अध्ययन रोडमैप तैयार किया जा रहा है...',
      generateMyRoadmap: 'मेरा अध्ययन रोडमैप तैयार करें'
    },

    // Hero
    hero: {
      badge1: 'नर्सरी से 12वीं',
      badgeJee: 'JEE',
      badgeNeet: 'NEET',
      titleLine1: 'AI-आधारित शिक्षा, जो',
      titleHighlight: 'बढ़े',
      titleLine2: 'हर छात्र के साथ।',
      description: 'नर्सरी से कक्षा 12 तक की स्कूली शिक्षा, साथ ही JEE और NEET की तैयारी के लिए YouTube कोर्स पाथवे, क्विज़ और प्रगति-ट्रैकिंग कंटेंट।',
      ctaPrimary: 'मुफ़्त में सीखना शुरू करें',
      ctaSecondary: 'कोर्स देखें',
      studentCount: '50K+',
      studentCountLabel: 'छात्र हमारे साथ सीख रहे हैं',
      featureLive: 'लाइव क्लासेस',
      featureLiveDesc: 'रियल टाइम में सीखें',
      featureMentors: 'AI विशेषज्ञ मेंटर',
      featureMentorsDesc: 'AI सपोर्ट के साथ डाउट हेल्प',
      featureMock: 'AI मॉक टेस्ट',
      featureMockDesc: 'एडेप्टिव प्रैक्टिस',
      featureProgress: 'AI प्रगति ट्रैकिंग',
      featureProgressDesc: 'डेटा-आधारित इनसाइट्स',
      featureAi: 'AI लर्निंग टूल',
      featureAiDesc: 'स्मार्ट तरीके से दिन-प्रतिदिन विषय खोजें',
      featureTrans: 'हिंदी अनुवाद',
      featureTransDesc: 'हिंदी में सीखने के लिए आसानी से स्विच करें',
      featureSpeech: 'टेक्स्ट टू स्पीच',
      featureSpeechDesc: 'वॉयस रिकग्निशन के साथ कंटेंट सुनें'
    },

    // Stats
    stats: {
      courses: 'YouTube कोर्स',
      quizQuestions: 'क्विज़ प्रश्न',
      videoLessons: 'वीडियो लेसन',
      classesCovered: 'कक्षाएँ कवर'
    },

    // Why Choose
    whyChoose: {
      kicker: 'प्रोजेक्ट एकलव्य क्यों चुनें',
      headingPart1: 'एक छात्र को जो चाहिए, सब एक जगह,',
      headingHighlight: 'AI की शक्ति के साथ',
      intro: 'सीखें, अभ्यास करें, टेस्ट दें और आगे बढ़ें — सब एक सरल प्लेटफॉर्म में।',
      card1Title: 'संरचित शिक्षण मार्ग',
      card1Text: 'स्कूल पाठ्यक्रम, JEE और NEET की तैयारी के साथ संरेखित चरण-दर-चरण शिक्षण यात्राएँ।',
      card2Title: 'प्रीमियम मेंटरशिप',
      card2Text: 'जब भी आपको आवश्यकता हो, व्यक्तिगत मार्गदर्शन, लाइव डाउट सपोर्ट और विशेषज्ञ मेंटरशिप प्राप्त करें।',
      card3Title: 'गहन विश्लेषण',
      card3Text: 'सरल, कार्रवाई योग्य अंतर्दृष्टि के साथ सीखने की प्रगति, क्विज़ प्रदर्शन और ताकतों को ट्रैक करें।',
      card4Title: 'स्मार्ट लर्निंग',
      card4Text: 'एक ही एकीकृत प्लेटफॉर्म से वीडियो पाठ, नोट्स, क्विज़ और अभ्यास टेस्ट तक पहुँच प्राप्त करें।',
      card5Title: 'अभ्यास और मूल्यांकन',
      card5Text: 'अध्याय-वार क्विज़, मॉक टेस्ट और त्वरित प्रदर्शन फीडबैक के माध्यम से अवधारणाओं को मजबूत करें।',
      card6Title: 'सफलता और उत्कृष्टता',
      card6Text: 'नर्सरी से 12वीं, JEE, NEET और प्रतियोगी परीक्षाओं की तैयारी के लिए डिज़ाइन किया गया।',
      card7Title: 'AI-संचालित शिक्षण',
      card7Text: 'एक AI ट्यूटर के साथ स्मार्ट तरीके से सीखें जो आपकी गति और सीखने की जरूरतों के अनुकूल बनता है।',
      card8Title: 'हिंदी अनुवाद',
      card8Text: 'पूरे प्लेटफॉर्म पर सहज अनुवाद के साथ हर पाठ को हिंदी में समझें।',
      card9Title: 'टेक्स्ट टू स्पीच',
      card9Text: 'प्राकृतिक, AI-संचालित आवाज़ के साथ पाठ और अध्ययन सामग्री को सुनें।'
    },

    // Courses section
    courses: {
      kicker: 'हमारे कोर्स',
      heading: 'सिग्नेचर पाठ्यक्रम',
      description: 'भारतीय स्कूल और प्रवेश परीक्षा के छात्रों के लिए YouTube-आधारित कोर्स पाथवे।',
      viewAll: 'सभी कोर्स देखें',
      learnMore: 'और जानें'
    },

    // Testimonials
    testimonials: {
      kicker: 'प्रशंसापत्र',
      heading: 'हमारे छात्र क्या कहते हैं',
      card1Name: 'अनन्या शर्मा',
      card1Label: 'कक्षा 10 छात्रा',
      card1Text: 'कोर्स पाथ ने मुझे हर लेसन के बाद प्रश्नों के साथ विज्ञान के अध्याय दोहराने में मदद की।',
      card2Name: 'रोहन मेहता',
      card2Label: 'JEE एस्पिरेंट',
      card2Text: 'प्रैक्टिस के तुरंत बाद क्विज़ स्कोर देखने से मॉक से पहले कमज़ोर चैप्टर स्पष्ट हो गए।',
      card3Name: 'नेहा पाटिल',
      card3Label: 'NEET एस्पिरेंट',
      card3Text: 'यहाँ की बायोलॉजी क्विज़ पूरी तरह NCERT-ओरिएंटेड हैं। स्पष्टीकरण बहुत अच्छे हैं।',
      card4Name: 'आरव गुप्ता',
      card4Label: 'कक्षा 12 बोर्ड',
      card4Text: 'फिज़िक्स डेरिवेशन रिवाइज़ करने और मॉक टेस्ट देने का सबसे अच्छा तरीका। 100% रिकमेंडेड!',
      card5Name: 'आदित्य कुमार',
      card5Label: 'JEE 2026',
      card5Text: 'सरल इंटरफ़ेस, कोई अव्यवस्था नहीं, और सीधे टॉप टीचर प्लेलिस्ट से जुड़ा। घंटों बचाए।',
      card6Name: 'पूजा अय्यर',
      card6Label: 'कक्षा 10 बोर्ड',
      card6Text: 'मैथ फाउंडेशन फॉलो करना बहुत आसान लगा। प्रगति ट्रैकिंग मुझे प्रेरित रखती है।'
    },

    // CTA
    cta: {
      heading: 'AI-आधारित शिक्षा शुरू करने के लिए तैयार?',
      description: 'स्कूल परीक्षा, JEE और NEET की तैयारी कर रहे छात्रों से जुड़ें — फोकस्ड वीडियो कोर्स और क्विज़ के साथ।',
      button: 'मेंबरशिप के लिए आवेदन करें'
    },

    // Footer
    footer: {
      tagline: 'भारतीय K-12, JEE और NEET छात्रों के लिए फ्रंटएंड-ओनली AI-आधारित प्रोजेक्ट एकलव्य डेमो।',
      product: 'प्रोडक्ट',
      productCourses: 'कोर्स',
      productQuizzes: 'क्विज़',
      productPricing: 'मूल्य',
      company: 'कंपनी',
      companyAbout: 'हमारे बारे में',
      companyStories: 'सफलता की कहानियाँ',
      companyContact: 'संपर्क करें',
      support: 'सहायता',
      supportHelp: 'हेल्प सेंटर',
      supportPrivacy: 'गोपनीयता नीति',
      supportTerms: 'सेवा की शर्तें'
    },

    // Course Detail
    courseDetail: {
      backToCourses: 'कोर्स पर वापस जाएँ',
      youtubeLabel: 'YouTube कोर्स',
      openOnYoutube: 'YouTube पर खोलें',
      learningPath: 'लर्निंग पाथ',
      backendNote: 'बैकएंड-रेडी स्कोप',
      backendNoteDesc: 'कोर्स, क्विज़, उत्तर और प्रगति ऑब्जेक्ट डेटा स्ट्रक्चर में अलग हैं ताकि बाद में API उन्हें बदल सकें।',
      quizKicker: 'रियल प्रैक्टिस क्विज़',
      attempted: 'प्रयास किए',
      explanation: 'व्याख्या'
    },

    // AI Roadmap
    aiRoadmap: {
      title: '2026 में AI-आधारित शिक्षा:',
      subtitle: 'स्मार्ट लर्निंग के लिए चरण-दर-चरण मार्गदर्शिका',
      step1: 'अपने सीखने के लक्ष्य निर्धारित करें',
      step2: 'स्मार्ट दिन-प्रतिदिन विषय खोज',
      step3: 'व्यक्तिगत अध्ययन मॉड्यूल',
      step4: 'आसानी से हिंदी में स्विच करें',
      step5: 'अपनी पसंदीदा भाषा में सीखें',
      step6: 'वॉयस रिकग्निशन के साथ सुनें',
      step7: 'AI के साथ अपनी प्रगति ट्रैक करें'
    },

    // AI For Learning (Bharat section)
    aiForLearning: {
      kicker: 'भारत के लिए AI',
      heading: 'AI जो आपके बच्चे की भाषा बोलता है — सच में',
      subheading: 'ग्रामीण और छोटे शहरों के छात्रों के लिए बना, प्रोजेक्ट एकलव्य भारतीय AI का उपयोग करके आपके बच्चे की समझ की भाषा में पढ़ाता, सिखाता और समझाता है।',
      card1Title: 'सर्वम AI',
      card1Text: 'भारत के अपने सर्वम AI मॉडल जो हिंदी, तमिल, तेलुगु, बंगाली और अन्य भाषाएँ समझते और बोलते हैं — ताकि हर बच्चा बोलकर सीख सके।',
      card2Title: 'भारत के लिए बना',
      card2Text: 'भारतीय पाठ्यक्रम, भारतीय उच्चारण और ग्रामीण कक्षा की ज़रूरतों के अनुसार डिज़ाइन — सिलिकॉन वैली से आयातित नहीं।',
      card3Title: 'AI ट्यूटर',
      card3Text: 'बच्चे की अपनी भाषा में, अपनी गति से, धैर्य से समझाने वाला AI ट्यूटर — प्राइवेट ट्यूशन की ज़रूरत नहीं।',
      card4Title: 'AI नोट्स और PDF',
      card4Text: 'छात्र की भाषा में AI-जनित नोट्स और PDF — एक बार डाउनलोड करें, स्थानीय रूप से प्रिंट करें, कभी भी ऑफ़लाइन पढ़ें।'
    }
  }
};
