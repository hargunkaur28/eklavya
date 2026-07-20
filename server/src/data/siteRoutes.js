// Static site route table for navigation intent matching.
// Cross-checked against client/src/App.jsx (Routes definition, lines 220-258).
// DO NOT add routes that don't exist in App.jsx.

const siteRoutes = [
  { path: '/', label: 'Home', labelHi: 'होम' },
  { path: '/courses', label: 'Courses', labelHi: 'कोर्स' },
  { path: '/courses/:id', label: 'Course Detail', labelHi: 'कोर्स विवरण', dynamic: true },
  { path: '/onboarding', label: 'Take a Diagnostic Quiz', labelHi: 'डायग्नोस्टिक क्विज़ दें', requiresAuth: true },
  { path: '/dashboard', label: 'Your Dashboard', labelHi: 'आपका डैशबोर्ड', requiresAuth: true },
  { path: '/review/:id', label: 'Diagnostic Review', labelHi: 'डायग्नोस्टिक रिव्यू', requiresAuth: true, dynamic: true },
  { path: '/roadmap/:roadmapId/day/:dayNumber', label: 'Study Day Detail', labelHi: 'अध्ययन दिवस विवरण', requiresAuth: true, dynamic: true },
  { path: '/login', label: 'Log In', labelHi: 'लॉग इन' },
  { path: '/signup', label: 'Sign Up', labelHi: 'साइन अप' }
];

// Keywords that map user messages to specific routes.
// Each entry: an array of trigger keywords/phrases → the route index in siteRoutes.
const navigationKeywords = [
  { keywords: ['home', 'homepage', 'main page', 'landing'], routeIndex: 0 },
  { keywords: ['courses', 'course list', 'all courses', 'browse courses'], routeIndex: 1 },
  { keywords: ['diagnostic', 'quiz', 'test', 'assessment', 'onboarding'], routeIndex: 3 },
  { keywords: ['dashboard', 'my progress', 'my roadmap', 'progress'], routeIndex: 4 },
  { keywords: ['review', 'results', 'diagnostic review', 'quiz results', 'score'], routeIndex: 5 },
  { keywords: ['day detail', 'study day', 'lesson', 'today', 'day plan'], routeIndex: 6 },
  { keywords: ['login', 'log in', 'sign in', 'signin'], routeIndex: 7 },
  { keywords: ['signup', 'sign up', 'register', 'create account', 'join'], routeIndex: 8 }
];

export { siteRoutes, navigationKeywords };
