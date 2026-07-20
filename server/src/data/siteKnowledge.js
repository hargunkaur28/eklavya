// Factual site knowledge for grounding Groq's general Q&A responses.
// Sourced from actual site content (courses.js, homepage, About sections).
// This is injected into the system prompt so the AI answers accurately
// about Project Eklavya rather than hallucinating marketing copy.

const siteKnowledge = `
Project Eklavya is a personalized, AI-driven learning platform built for Indian students. It uses artificial intelligence to create customized study plans based on each student's actual skill level.

AVAILABLE COURSES (as of 2026):
1. Class 10 Science Foundation (inspired by Physics Wallah Udaan) — covers CBSE Class 10 Science: chemical reactions, acids & bases, life processes, electricity, light & human eye.
2. JEE Foundation for Class 11 (inspired by Physics Wallah Arjuna) — covers kinematics, laws of motion, units & dimensions, work & energy, projectile motion, calculus basics, quadratic equations.
3. NEET Biology for Class 12 (inspired by Unacademy) — covers cell biology, photosynthesis, genetics, human physiology, enzymes & digestion, ecology.

HOW IT WORKS:
1. Sign up for a free account on the site.
2. Choose a course from the Courses page.
3. Take a short AI-generated Diagnostic Quiz to assess your current knowledge level. The quiz identifies your weak and strong topics.
4. Based on your quiz results, the AI generates a Personalized Study Roadmap — a day-by-day plan (typically 10-15 days) focusing extra time on your weak areas.
5. Each day in the roadmap includes an AI-written lesson explanation and curated YouTube video resources from trusted Indian educational channels (Physics Wallah, Vedantu, Unacademy, Khan Academy India, Aakash).
6. Mark days as completed to track your progress on the Dashboard.

KEY FEATURES:
- Bilingual support: the entire site works in both English and Hindi. Use the language toggle in the navigation bar to switch.
- Voice support: lesson content can be read aloud using text-to-speech. Voice input is also available for the chatbot.
- AI-powered explanations and quiz question generation via Groq AI.
- Real YouTube video recommendations (never fabricated links — all videos come from the YouTube Data API).
- Progress tracking on your personal Dashboard.

GETTING STARTED:
- Visit the homepage and click "Sign Up" or navigate to /signup.
- After signing up, go to /onboarding to take your first diagnostic quiz.
- Your personalized roadmap will be generated automatically after the quiz.
- Access your roadmap and progress anytime from /dashboard.

IMPORTANT LIMITATIONS:
- The site currently recommends YouTube videos only — it cannot search the general web for articles or websites.
- Study plans are generated for the three courses listed above. Other subjects/grades are not yet supported.
- The chatbot can answer general academic questions, but for exam-specific strategies you should consult your teachers.
`.trim();

export default siteKnowledge;
