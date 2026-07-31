// Workstream A1 — the SYLLABUS BLUEPRINT.
//
// Why this file exists: the diagnostic used to ask Groq for "6 questions on
// Class 10 Maths" with nothing else to go on, and got back Class-6 arithmetic
// ("if r = 4, what is the diameter?"). A wrong-level diagnostic produces a wrong
// roadmap, so the fix is to stop asking for a subject and start asking for a
// SPECIFIC CHAPTER of the real NCERT/CBSE syllabus, at a difficulty pinned by
// worked exemplars.
//
// This EXTENDS the taxonomy (server/src/config/taxonomy.js) — it does not fork
// it. Keys are (grade → subject → subSubject), using '' for non-split subjects,
// matching the existing course-identity convention.
//
// Shape of one entry:
//   {
//     chapters: [{ id, name, concepts: [..3-6..], diagramEligible: Boolean }],
//     difficultyAnchor: 'prose describing the expected cognitive level',
//     exemplars: { tooEasy, correct, tooHard }
//   }
//
// `diagramEligible` (Workstream D3) marks chapters where a figure is often
// genuinely required — geometry, optics, circuits, cell structure. Algebra,
// grammar and economics are not eligible and never get one.

import {
  normalizeGrade, normalizeSubject, normalizeSubSubject,
  canonicalSubject, hasSubSubjects, fusionSubSubjectFor
} from './taxonomy.js';

// ── Per-grade cognitive-level anchors ───────────────────────────────────────
// Used verbatim by entries below where useful, and as the difficultyAnchor for
// any grade+subject combination that has no hand-authored blueprint (the
// generated-blueprint fallback path — see resolveBlueprint in
// utils/diagnosticEngine.js). Covers every grade in GRADES.
export const GRADE_LEVEL_ANCHORS = {
  'Nursery': 'Pre-school level. Recognition and matching only — shapes, colours, counting to 10, first letters. One idea per question, no reading of long sentences.',
  'KG': 'Kindergarten level. Letter sounds, counting to 20, simple comparison (bigger/smaller, more/less). One step, picture-friendly language.',
  'Class 1': 'CBSE Class 1 level. Single-step addition and subtraction within 20, simple sight words, immediate observation. No multi-step reasoning.',
  'Class 2': 'CBSE Class 2 level. Two-digit addition/subtraction, simple multiplication tables, short sentences. At most one intermediate step.',
  'Class 3': 'CBSE Class 3 level. Multiplication and division facts, simple fractions, short reading comprehension. One or two steps.',
  'Class 4': 'CBSE Class 4 level. Multi-digit operations, factors and multiples, simple measurement conversion, short word problems with two steps.',
  'Class 5': 'CBSE Class 5 level. Fractions and decimals, area and perimeter, percentages introduced, two-step word problems.',
  'Class 6': 'CBSE Class 6 level. Integers, ratio and proportion, basic algebraic expressions, simple geometry with definitions. Two steps.',
  'Class 7': 'CBSE Class 7 level. Rational numbers, simple linear equations, congruence, data handling. Two to three steps and a stated formula.',
  'Class 8': 'CBSE Class 8 level. Exponents, factorisation, linear equations in one variable, mensuration of standard solids, understanding cause and effect. Multi-step.',
  'Class 9': 'CBSE Class 9 level. Polynomials, coordinate geometry, Euclid-style proof reasoning, laws of motion, atomic structure. Requires selecting the right result and applying it.',
  'Class 10': 'CBSE Class 10 board level. Multi-step problems requiring a formula plus algebraic manipulation, or a chain of reasoning across two concepts. NOT single-step recall of a definition or a one-substitution arithmetic question.',
  'Class 11': 'CBSE Class 11 / competitive-foundation level. Problems combining two or more concepts, requiring derivation, case analysis, or a non-obvious substitution. Definitions alone are never enough.',
  'Class 12': 'CBSE Class 12 board / NEET-JEE level. Application and analysis across chapters — interpret a scenario, select the governing principle, and reason to a conclusion. Pure recall of a labelled diagram is below level.'
};

const C10 = GRADE_LEVEL_ANCHORS['Class 10'];
const C11 = GRADE_LEVEL_ANCHORS['Class 11'];
const C12 = GRADE_LEVEL_ANCHORS['Class 12'];

// ── Class 10 · Science ──────────────────────────────────────────────────────

const C10_PHYSICS_CHAPTERS = [
  {
    id: 'x10-phy-light',
    name: 'Light — Reflection and Refraction',
    concepts: [
      'mirror formula and magnification for concave/convex mirrors',
      'lens formula, power of a lens and sign conventions',
      'refractive index and Snell\'s law',
      'ray diagrams for image formation and their characteristics'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-phy-human-eye',
    name: 'The Human Eye and the Colourful World',
    concepts: [
      'accommodation and the power of the eye lens',
      'myopia, hypermetropia and presbyopia — correction and lens power calculation',
      'dispersion through a prism and the recombination of white light',
      'atmospheric refraction — twinkling of stars, advanced sunrise, scattering (Tyndall effect)'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-phy-electricity',
    name: 'Electricity',
    concepts: [
      'Ohm\'s law and resistivity',
      'resistors in series and parallel — equivalent resistance networks',
      'heating effect of current and electrical power (P = I²R, P = V²/R)',
      'circuit analysis with ammeters and voltmeters'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-phy-magnetic-effects',
    name: 'Magnetic Effects of Electric Current',
    concepts: [
      'magnetic field pattern of a straight conductor, loop and solenoid',
      'right-hand thumb rule and Fleming\'s left-hand rule',
      'force on a current-carrying conductor in a magnetic field',
      'electromagnetic induction, Fleming\'s right-hand rule and the AC/DC generator'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-phy-energy-sources',
    name: 'Sources of Energy',
    concepts: [
      'characteristics of a good source of energy',
      'conventional sources — thermal, hydro, biomass and their limitations',
      'non-conventional sources — solar, wind, tidal, geothermal, nuclear',
      'environmental consequences and energy conversion efficiency'
    ],
    diagramEligible: false
  }
];

const C10_CHEMISTRY_CHAPTERS = [
  {
    id: 'x10-chem-reactions',
    name: 'Chemical Reactions and Equations',
    concepts: [
      'balancing chemical equations and the law of conservation of mass',
      'types of reaction — combination, decomposition, displacement, double displacement',
      'oxidation and reduction, identifying the oxidising/reducing agent',
      'corrosion and rancidity'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-chem-acids-bases',
    name: 'Acids, Bases and Salts',
    concepts: [
      'reactions of acids and bases with metals, carbonates and each other',
      'pH scale and its everyday applications',
      'strength of acids/bases in terms of H⁺ and OH⁻ ion concentration',
      'preparation and uses of washing soda, baking soda, bleaching powder and plaster of Paris'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-chem-metals',
    name: 'Metals and Non-metals',
    concepts: [
      'physical and chemical properties of metals versus non-metals',
      'reactivity series and displacement reactions',
      'ionic bonding and the properties of ionic compounds',
      'extraction of metals — roasting, calcination, reduction and electrolytic refining'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-chem-carbon',
    name: 'Carbon and its Compounds',
    concepts: [
      'covalent bonding, catenation and tetravalency of carbon',
      'homologous series, functional groups and IUPAC nomenclature',
      'isomerism in saturated hydrocarbons',
      'chemical properties — combustion, oxidation, addition and substitution reactions',
      'ethanol and ethanoic acid — properties, esterification and saponification'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-chem-periodic',
    name: 'Periodic Classification of Elements',
    concepts: [
      'Dobereiner\'s triads, Newlands\' octaves and Mendeleev\'s periodic table',
      'the modern periodic law and the position of an element from its electronic configuration',
      'periodic trends — atomic size, valency, metallic and non-metallic character',
      'predicting properties from group and period position'
    ],
    diagramEligible: false
  }
];

const C10_BIOLOGY_CHAPTERS = [
  {
    id: 'x10-bio-life-processes',
    name: 'Life Processes',
    concepts: [
      'autotrophic nutrition and the mechanism of photosynthesis, stomatal opening',
      'human digestive system — enzymes, their sites of action and substrates',
      'respiration — aerobic vs anaerobic, human respiratory system and gaseous exchange',
      'double circulation, structure of the heart, blood vessels and transport in plants (xylem/phloem)',
      'excretion — nephron structure and urine formation, dialysis'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-bio-control',
    name: 'Control and Coordination',
    concepts: [
      'neuron structure, synapse and the reflex arc',
      'human brain — regions and their functions, spinal cord',
      'endocrine glands and their hormones, feedback regulation',
      'plant hormones and tropic/nastic movements'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-bio-reproduction',
    name: 'How do Organisms Reproduce?',
    concepts: [
      'asexual reproduction — fission, budding, fragmentation, regeneration, vegetative propagation',
      'sexual reproduction in flowering plants — pollination, fertilisation, seed formation',
      'human reproductive system and the menstrual cycle',
      'reproductive health, contraception and its methods'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-bio-heredity',
    name: 'Heredity and Evolution',
    concepts: [
      'Mendel\'s monohybrid and dihybrid crosses, dominance and independent assortment',
      'sex determination in humans',
      'acquired versus inherited traits',
      'speciation, evolution, homologous/analogous organs and fossil evidence'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-bio-environment',
    name: 'Our Environment & Management of Natural Resources',
    concepts: [
      'ecosystem components, food chains, food webs and trophic levels',
      'the ten per cent law and biomagnification',
      'ozone depletion and waste management',
      'sustainable management — the 3 Rs, forests, water harvesting, coal and petroleum'
    ],
    diagramEligible: true
  }
];

const C10_SCIENCE_EXEMPLARS = {
  tooEasy: 'What is the SI unit of electric current?',
  correct: 'Three resistors of 6 Ω, 3 Ω and 2 Ω are connected in parallel across a 6 V battery. Calculate the total current drawn from the battery and the power dissipated in the 3 Ω resistor.',
  tooHard: 'Derive the Biot–Savart law from Maxwell\'s equations and use it to obtain the field of an arbitrary current distribution.'
};

// ── Class 10 · Maths ────────────────────────────────────────────────────────

const C10_MATHS_CHAPTERS = [
  {
    id: 'x10-maths-real-numbers',
    name: 'Real Numbers',
    concepts: [
      'Euclid\'s division lemma and the fundamental theorem of arithmetic',
      'HCF and LCM by prime factorisation, and the HCF × LCM = product relation',
      'proving irrationality of numbers such as √2, √3, 5 − √3',
      'decimal expansions — terminating versus non-terminating recurring'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-maths-polynomials',
    name: 'Polynomials',
    concepts: [
      'relationship between the zeroes and the coefficients of a quadratic polynomial',
      'forming a polynomial from given zeroes',
      'division algorithm for polynomials',
      'reading the number of zeroes from a graph'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-maths-linear-equations',
    name: 'Pair of Linear Equations in Two Variables',
    concepts: [
      'graphical and algebraic solution — substitution, elimination, cross-multiplication',
      'conditions for consistent, inconsistent and dependent systems using a₁/a₂, b₁/b₂, c₁/c₂',
      'word problems on ages, speed–distance, fractions and two-digit numbers',
      'equations reducible to a pair of linear equations'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-maths-quadratic',
    name: 'Quadratic Equations',
    concepts: [
      'solving by factorisation and by the quadratic formula',
      'discriminant and the nature of roots',
      'forming a quadratic equation from a word problem and rejecting an inadmissible root',
      'problems on speed, time, area and consecutive numbers'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-maths-ap',
    name: 'Arithmetic Progressions',
    concepts: [
      'nth term of an AP and its use in reverse (find n, a or d)',
      'sum of the first n terms, and the sum of a specified block of terms',
      'identifying whether a sequence is an AP',
      'real-life AP word problems — instalments, savings, seating rows'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-maths-triangles',
    name: 'Triangles',
    concepts: [
      'criteria for similarity — AAA, SAS, SSS',
      'basic proportionality theorem (Thales) and its converse',
      'ratio of areas of similar triangles',
      'Pythagoras theorem and its converse, applied in composite figures'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-maths-coordinate',
    name: 'Coordinate Geometry',
    concepts: [
      'distance formula and proving a figure is a particular quadrilateral',
      'section formula, including internal division in a given ratio',
      'midpoint and centroid',
      'area of a triangle from its vertices, and the collinearity condition'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-maths-trigonometry',
    name: 'Introduction to Trigonometry',
    concepts: [
      'trigonometric ratios and their values at 0°, 30°, 45°, 60°, 90°',
      'trigonometric identities — sin²θ + cos²θ = 1 and its two companions',
      'proving identities by algebraic manipulation',
      'complementary-angle relationships'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-maths-heights-distances',
    name: 'Some Applications of Trigonometry',
    concepts: [
      'angle of elevation and angle of depression',
      'two-observer and two-object height problems',
      'problems where the observer moves and the angle changes',
      'translating a described scene into a labelled right-triangle figure'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-maths-circles',
    name: 'Circles',
    concepts: [
      'tangent to a circle is perpendicular to the radius at the point of contact',
      'lengths of tangents drawn from an external point are equal',
      'angle between two tangents and the angle subtended at the centre',
      'tangent–chord configurations and cyclic quadrilateral results'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-maths-areas-circles',
    name: 'Areas Related to Circles',
    concepts: [
      'area and perimeter of a sector and a segment',
      'area of combinations of plane figures (circle inscribed in a square, etc.)',
      'length of an arc for a given central angle',
      'shaded-region problems requiring subtraction of areas'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-maths-surface-volume',
    name: 'Surface Areas and Volumes',
    concepts: [
      'surface area and volume of combinations of solids (cone on cylinder, hemisphere on cube)',
      'conversion of one solid into another with volume conserved',
      'frustum of a cone — volume, curved surface area, total surface area',
      'problems involving flow rate, filling and emptying'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-maths-statistics',
    name: 'Statistics',
    concepts: [
      'mean of grouped data — direct, assumed mean and step-deviation methods',
      'mode of grouped data from the modal class formula',
      'median of grouped data and cumulative frequency',
      'reading and constructing a cumulative frequency (ogive) curve'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-maths-probability',
    name: 'Probability',
    concepts: [
      'classical definition of probability and the sample space',
      'complementary events, P(E) + P(not E) = 1',
      'problems on dice, cards, coins and marbles including compound cases',
      'probability from a two-stage experiment'
    ],
    diagramEligible: false
  }
];

// ── Class 10 · English ──────────────────────────────────────────────────────

const C10_ENG_WRITING_CHAPTERS = [
  {
    id: 'x10-eng-formal-letter',
    name: 'Formal Letter Writing',
    concepts: [
      'letter to the editor — structure, register and persuasive argument',
      'letter of complaint / enquiry / order — sequencing of facts',
      'job application with a bio-data',
      'correct format: sender address, date, receiver, subject line, salutation, closing'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-analytical-paragraph',
    name: 'Analytical Paragraph',
    concepts: [
      'interpreting a bar chart, pie chart, line graph or table into prose',
      'identifying the trend, the outlier and the comparison worth stating',
      'topic sentence, supporting evidence and a concluding inference',
      'using comparison and contrast connectives without listing raw numbers'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-article-speech',
    name: 'Article and Speech Writing',
    concepts: [
      'article format — title, byline, introduction, body, conclusion',
      'building an argument with reasons and examples rather than assertions',
      'speech conventions — addressing the audience, rhetorical devices, call to action',
      'maintaining a consistent formal register within the word limit'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-story-descriptive',
    name: 'Story and Descriptive Writing',
    concepts: [
      'developing a story from a given cue, outline or opening line',
      'plot structure — exposition, conflict, climax, resolution',
      'characterisation and setting through concrete sensory detail',
      'consistent narrative tense and point of view'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-notice-invitation',
    name: 'Notice, Invitation and Email',
    concepts: [
      'notice — box format, heading, date, issuing authority, essential details only',
      'formal and informal invitations and their replies',
      'formal email conventions — subject line, brevity, sign-off',
      'third person and passive voice usage in official writing'
    ],
    diagramEligible: false
  }
];

const C10_ENG_GRAMMAR_CHAPTERS = [
  {
    id: 'x10-eng-tenses',
    name: 'Tenses',
    concepts: [
      'choosing between simple, continuous, perfect and perfect continuous forms',
      'sequence of tenses in complex sentences',
      'the use of present tense for future arrangements and universal truths',
      'error correction involving tense shift within a passage'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-modals',
    name: 'Modals',
    concepts: [
      'obligation, advice and necessity — must, should, ought to, have to',
      'permission and possibility — may, might, can, could',
      'expressing degrees of certainty in past and present',
      'semi-modals and their negative/interrogative forms'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-subject-verb',
    name: 'Subject–Verb Concord',
    concepts: [
      'collective nouns, uncountable nouns and nouns plural in form but singular in sense',
      'concord with either/or, neither/nor, each, every, none',
      'intervening phrases between subject and verb',
      'concord in relative clauses and inverted sentences'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-reported-speech',
    name: 'Reported Speech',
    concepts: [
      'converting statements, questions, commands and requests to indirect speech',
      'backshift of tense, pronouns and time/place expressions',
      'reporting verbs and their appropriate selection',
      'reported speech within a dialogue-completion task'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-determiners-prepositions',
    name: 'Determiners and Prepositions',
    concepts: [
      'articles — definite, indefinite and zero article',
      'quantifiers — much/many, few/a few, little/a little',
      'prepositions of time, place and movement, and prepositional verbs',
      'gap-filling and error-spotting in a connected passage'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-sentence-transformation',
    name: 'Sentence Transformation and Voice',
    concepts: [
      'active to passive voice across tenses, including imperatives',
      'simple, compound and complex sentence conversion',
      'clauses — noun, adjective and adverb clauses',
      'joining sentences using conjunctions and non-finites'
    ],
    diagramEligible: false
  }
];

const C10_ENG_READING_CHAPTERS = [
  {
    id: 'x10-eng-factual-passage',
    name: 'Factual / Discursive Passage Comprehension',
    concepts: [
      'locating explicitly stated information under time pressure',
      'distinguishing fact from opinion and identifying the author\'s stance',
      'interpreting data referred to within the passage',
      'answering "which of the following is NOT stated" style questions'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-inference',
    name: 'Inference and Vocabulary in Context',
    concepts: [
      'drawing a conclusion the passage implies but does not state',
      'deducing the meaning of an unfamiliar word from context',
      'identifying tone, purpose and intended audience',
      'recognising the referent of a pronoun across sentences'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-note-making',
    name: 'Note-making and Summarising',
    concepts: [
      'hierarchical note format with headings and sub-headings',
      'consistent abbreviations and a key',
      'distilling a paragraph to its controlling idea',
      'writing a summary within a fixed word limit without adding opinion'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-literature-prose',
    name: 'Literature — Prose (First Flight / Footprints Without Feet)',
    concepts: [
      'theme, character motivation and the turning point of a chapter',
      'value-based and extract-based questions',
      'author\'s use of irony, humour and contrast',
      'relating the text to a contemporary situation'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eng-literature-poetry',
    name: 'Literature — Poetry',
    concepts: [
      'central idea and the poet\'s message',
      'figures of speech — metaphor, simile, personification, alliteration, imagery',
      'rhyme scheme and its effect on tone',
      'extract-based interpretation of a stanza'
    ],
    diagramEligible: false
  }
];

const C10_ENGLISH_EXEMPLARS_WRITING = {
  tooEasy: 'Write the correct plural of "child".',
  correct: 'The bar graph shows the percentage of households in four states with access to piped water in 2011 and 2021. Write an analytical paragraph of 100–120 words describing the trend, identifying the state with the sharpest change and suggesting one reason for it.',
  tooHard: 'Write a 3000-word comparative dissertation on post-colonial narrative technique in Rushdie and Roy with citations.'
};

const C10_ENGLISH_EXEMPLARS_GRAMMAR = {
  tooEasy: 'Fill in the blank: She ___ a doctor. (is / are)',
  correct: 'Rewrite in reported speech: The coach said to the players, "If you had trained harder last month, you would not be struggling now."',
  tooHard: 'Parse the sentence using X-bar theory and label every functional projection.'
};

const C10_ENGLISH_EXEMPLARS_READING = {
  tooEasy: 'What is the title of the passage?',
  correct: 'The writer says urban lakes "are treated as land banks rather than water bodies". What does this criticism imply about the priorities of city planners, and which detail later in the passage supports your answer?',
  tooHard: 'Perform a Derridean deconstruction of the passage\'s central binary opposition.'
};

// ── Class 10 · Social Science ───────────────────────────────────────────────

const C10_HISTORY_CHAPTERS = [
  {
    id: 'x10-hist-europe-nationalism',
    name: 'The Rise of Nationalism in Europe',
    concepts: [
      'the French Revolution and the idea of the nation-state',
      'the making of Germany and Italy',
      'liberal nationalism, conservatism and the Vienna Congress of 1815',
      'visual sources — allegories such as Marianne and Germania'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hist-india-nationalism',
    name: 'Nationalism in India',
    concepts: [
      'the Rowlatt Act, Jallianwala Bagh and the Non-Cooperation Movement',
      'Civil Disobedience, the Salt March and the Round Table Conferences',
      'differing participation of peasants, tribals, industrialists and women',
      'the sense of collective belonging — symbols, folklore and the national flag'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hist-global-world',
    name: 'The Making of a Global World',
    concepts: [
      'pre-modern trade, the silk routes and the Columbian exchange',
      'nineteenth-century flows of trade, labour and capital',
      'the inter-war economy, the Great Depression and its impact on India',
      'Bretton Woods, decolonisation and the rise of MNCs'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hist-industrialisation',
    name: 'The Age of Industrialisation',
    concepts: [
      'proto-industrialisation and the coming of the factory',
      'hand labour versus steam power and the pace of industrial change',
      'industrialisation in colonial India and the decline of Indian textiles',
      'market for goods — advertisements and manufactured demand'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hist-print-culture',
    name: 'Print Culture and the Modern World',
    concepts: [
      'the printing press in East Asia and Europe, and the print revolution',
      'print, religious debate and the Reformation',
      'print culture, censorship and nationalism in colonial India',
      'the impact of print on women, workers and reform movements'
    ],
    diagramEligible: false
  }
];

const C10_GEOGRAPHY_CHAPTERS = [
  {
    id: 'x10-geo-resources',
    name: 'Resources and Development',
    concepts: [
      'classification of resources by origin, exhaustibility, ownership and development status',
      'land use pattern in India and land degradation with its remedies',
      'major soil types of India, their distribution and characteristics',
      'soil erosion, conservation methods and sustainable development'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-geo-forest-wildlife',
    name: 'Forest and Wildlife Resources',
    concepts: [
      'IUCN classification of species — normal, endangered, vulnerable, rare, endemic, extinct',
      'causes of depletion of flora and fauna in India',
      'conservation strategies — Project Tiger, biosphere reserves, reserved and protected forests',
      'community and government participation in conservation'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-geo-water',
    name: 'Water Resources',
    concepts: [
      'water scarcity — causes beyond mere availability',
      'multi-purpose river projects, their benefits and the opposition to them',
      'rainwater harvesting traditions across regions of India',
      'inter-state water disputes and dam-induced displacement'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-geo-agriculture',
    name: 'Agriculture',
    concepts: [
      'primitive subsistence, intensive subsistence and commercial farming',
      'cropping seasons — rabi, kharif, zaid — and major crops with their geographic conditions',
      'technological and institutional reforms, MSP and food security',
      'contribution of agriculture to the national economy and employment'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-geo-minerals-energy',
    name: 'Minerals and Energy Resources',
    concepts: [
      'modes of occurrence of minerals and their distribution in India',
      'ferrous and non-ferrous minerals, and conservation of minerals',
      'conventional and non-conventional energy resources',
      'reading a mineral/energy distribution map of India'
    ],
    diagramEligible: true
  },
  {
    id: 'x10-geo-manufacturing',
    name: 'Manufacturing Industries',
    concepts: [
      'agro-based and mineral-based industries and their classification',
      'location factors for the iron and steel and the cotton textile industries',
      'industrial pollution and its control measures',
      'contribution of industry to the national economy'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-geo-lifelines',
    name: 'Lifelines of National Economy',
    concepts: [
      'roadways, railways, pipelines, waterways and airways — comparative advantages',
      'major ports and international trade of India',
      'communication networks and tourism as a trade',
      'interpreting a transport network map'
    ],
    diagramEligible: true
  }
];

const C10_CIVICS_CHAPTERS = [
  {
    id: 'x10-civ-power-sharing',
    name: 'Power Sharing',
    concepts: [
      'the Belgium and Sri Lanka case studies contrasted',
      'prudential versus moral reasons for power sharing',
      'forms of power sharing — horizontal, vertical, social groups, political parties',
      'majoritarianism and accommodation of diversity'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-civ-federalism',
    name: 'Federalism',
    concepts: [
      'features of federalism and the Union, State and Concurrent lists',
      'coming-together versus holding-together federations',
      'linguistic states, the language policy and centre–state relations',
      'decentralisation and the 1992 Panchayati Raj amendment'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-civ-gender-religion-caste',
    name: 'Gender, Religion and Caste',
    concepts: [
      'sexual division of labour and women\'s political representation',
      'communalism in politics and secularism in the Indian Constitution',
      'caste as a factor in electoral politics, and politics as a factor shaping caste',
      'feminist movements and legal safeguards'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-civ-political-parties',
    name: 'Political Parties',
    concepts: [
      'functions of political parties and the need for them',
      'one-party, two-party and multi-party systems',
      'national and state parties in India and recognition criteria',
      'challenges to parties — dynastic succession, money and muscle power, and reforms'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-civ-democracy-outcomes',
    name: 'Outcomes of Democracy',
    concepts: [
      'accountable, responsive and legitimate government',
      'democracy and economic growth, inequality and poverty',
      'accommodation of social diversity',
      'dignity, freedom of citizens and the expectation gap'
    ],
    diagramEligible: false
  }
];

const C10_ECONOMICS_CHAPTERS = [
  {
    id: 'x10-eco-development',
    name: 'Development',
    concepts: [
      'different people, different developmental goals and conflicting notions of development',
      'income and other criteria — per capita income, literacy rate, IMR, net attendance ratio',
      'Human Development Index and its indicators',
      'sustainability of development and resource depletion'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eco-sectors',
    name: 'Sectors of the Indian Economy',
    concepts: [
      'primary, secondary and tertiary sectors and their interdependence',
      'GDP and the historical change in the share of sectors',
      'organised versus unorganised sector, and public versus private sector',
      'underemployment, disguised unemployment and MGNREGA'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eco-money-credit',
    name: 'Money and Credit',
    concepts: [
      'money as a medium of exchange and the double coincidence of wants',
      'formal and informal sources of credit, and the terms of credit',
      'the role of the RBI in supervising formal credit',
      'self-help groups and the debt trap'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eco-globalisation',
    name: 'Globalisation and the Indian Economy',
    concepts: [
      'multinational corporations and the interlinking of production',
      'foreign trade, integration of markets and investment',
      'trade barriers, liberalisation and the WTO',
      'impact of globalisation on Indian producers and workers, and the fair-globalisation argument'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-eco-consumer-rights',
    name: 'Consumer Rights',
    concepts: [
      'consumer exploitation in the marketplace',
      'the six consumer rights and the Consumer Protection Act',
      'standardisation marks — ISI, AGMARK, Hallmark — and their scope',
      'redressal machinery — district, state and national commissions'
    ],
    diagramEligible: false
  }
];

const C10_SST_EXEMPLARS = {
  tooEasy: 'In which year did India gain independence?',
  correct: 'Explain why the Non-Cooperation Movement drew very different responses from Awadh peasants and from the Gudem hill tribals, and what this reveals about how nationalism was interpreted locally.',
  tooHard: 'Critically evaluate the Subaltern Studies collective\'s historiographical break with nationalist historiography, citing Guha and Chakrabarty.'
};

// Build the Fusion/Combined chapter set as a representative spread across the
// component areas rather than a concatenation (which would be far too long).
function spread(list, n) {
  if (list.length <= n) return list.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return [...new Map(out.map((c) => [c.id, c])).values()];
}

const C10_SCIENCE_COMBINED = [
  ...spread(C10_PHYSICS_CHAPTERS, 3),
  ...spread(C10_CHEMISTRY_CHAPTERS, 3),
  ...spread(C10_BIOLOGY_CHAPTERS, 3)
];

const C10_ENGLISH_FUSION = [
  ...spread(C10_ENG_WRITING_CHAPTERS, 3),
  ...spread(C10_ENG_GRAMMAR_CHAPTERS, 3),
  ...spread(C10_ENG_READING_CHAPTERS, 3)
];

const C10_SST_COMBINED = [
  ...spread(C10_HISTORY_CHAPTERS, 3),
  ...spread(C10_GEOGRAPHY_CHAPTERS, 3),
  ...spread(C10_CIVICS_CHAPTERS, 2),
  ...spread(C10_ECONOMICS_CHAPTERS, 2)
];

// ── Class 10 · Hindi ────────────────────────────────────────────────────────

const C10_HINDI_CHAPTERS = [
  {
    id: 'x10-hindi-vyakaran-shabd',
    name: 'व्याकरण — पद परिचय एवं शब्द-भेद (Grammar — Parts of Speech)',
    concepts: [
      'संज्ञा, सर्वनाम, विशेषण, क्रिया का पद परिचय',
      'रचना के आधार पर वाक्य भेद — सरल, संयुक्त, मिश्र',
      'वाच्य — कर्तृवाच्य, कर्मवाच्य, भाववाच्य और उनका परिवर्तन',
      'पदबंध की पहचान'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hindi-alankar-ras',
    name: 'अलंकार, रस एवं छंद (Figures of Speech, Rasa and Metre)',
    concepts: [
      'शब्दालंकार — अनुप्रास, यमक, श्लेष',
      'अर्थालंकार — उपमा, रूपक, उत्प्रेक्षा, अतिशयोक्ति, मानवीकरण',
      'रस के अंग — स्थायी भाव, विभाव, अनुभाव, संचारी भाव',
      'नौ रसों की पहचान उदाहरण से'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hindi-samas-muhavare',
    name: 'समास एवं मुहावरे-लोकोक्तियाँ (Compounds and Idioms)',
    concepts: [
      'समास के भेद — तत्पुरुष, कर्मधारय, द्विगु, द्वंद्व, बहुव्रीहि, अव्ययीभाव',
      'समास-विग्रह करना और समस्तपद बनाना',
      'मुहावरों का वाक्य में सटीक प्रयोग',
      'लोकोक्ति और मुहावरे का अंतर'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hindi-kavya',
    name: 'काव्य खंड (Poetry — Kshitij / Sparsh)',
    concepts: [
      'कविता का केंद्रीय भाव और कवि का संदेश',
      'काव्य-सौंदर्य — भाषा, बिंब, प्रतीक',
      'पद्यांश आधारित व्याख्या',
      'कवि परिचय और रचना का संदर्भ'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hindi-gadya',
    name: 'गद्य खंड (Prose — Kshitij / Sanchayan)',
    concepts: [
      'पाठ का मूल भाव एवं चरित्र-चित्रण',
      'गद्यांश आधारित बोध प्रश्न',
      'लेखक की शैली और व्यंग्य',
      'मूल्यपरक प्रश्न — पाठ से जीवन-मूल्य जोड़ना'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hindi-lekhan',
    name: 'लेखन कौशल (Writing Skills)',
    concepts: [
      'अनुच्छेद लेखन — संकेत बिंदुओं के आधार पर',
      'औपचारिक पत्र — प्रार्थना पत्र, संपादक के नाम पत्र',
      'सूचना, विज्ञापन एवं संदेश लेखन का प्रारूप',
      'लघुकथा लेखन एवं ई-मेल'
    ],
    diagramEligible: false
  },
  {
    id: 'x10-hindi-apathit',
    name: 'अपठित बोध (Unseen Passage)',
    concepts: [
      'अपठित गद्यांश से तथ्य और निष्कर्ष निकालना',
      'शीर्षक चयन एवं भाव-ग्रहण',
      'शब्दार्थ एवं विलोम संदर्भ के अनुसार',
      'अपठित काव्यांश की व्याख्या'
    ],
    diagramEligible: false
  }
];

// ── Class 11 · JEE Foundation ───────────────────────────────────────────────

const C11_JEE_CHAPTERS = [
  {
    id: 'x11-jee-units-dimensions',
    name: 'Units, Dimensions and Measurement',
    concepts: [
      'dimensional analysis to check and derive relations',
      'significant figures and error propagation in products and powers',
      'least count and instrument errors (vernier, screw gauge)',
      'limitations of the dimensional method'
    ],
    diagramEligible: false
  },
  {
    id: 'x11-jee-kinematics',
    name: 'Kinematics',
    concepts: [
      'equations of motion, relative velocity in one and two dimensions',
      'projectile motion — range, maximum height, trajectory equation',
      'graphical interpretation of x–t, v–t and a–t graphs',
      'motion on an inclined plane and river-boat problems'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-laws-of-motion',
    name: 'Laws of Motion and Friction',
    concepts: [
      'free-body diagrams for connected bodies and pulley systems',
      'static and kinetic friction, angle of repose',
      'pseudo forces in non-inertial frames',
      'circular motion — banking of roads and the conical pendulum'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-work-energy',
    name: 'Work, Energy and Power',
    concepts: [
      'work done by a variable force and the work–energy theorem',
      'conservative forces and potential energy curves',
      'elastic and inelastic collisions in one and two dimensions',
      'coefficient of restitution and power'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-rotation',
    name: 'Rotational Motion',
    concepts: [
      'moment of inertia, parallel and perpendicular axis theorems',
      'torque, angular momentum and its conservation',
      'rolling without slipping — energy distribution',
      'centre of mass of composite and continuous bodies'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-gravitation',
    name: 'Gravitation',
    concepts: [
      'gravitational field and potential, escape velocity',
      'orbital velocity, time period and Kepler\'s laws',
      'variation of g with altitude, depth and rotation of the earth',
      'satellite energy — binding energy and geostationary orbits'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-thermo',
    name: 'Thermodynamics and Kinetic Theory',
    concepts: [
      'first law applied to isothermal, adiabatic, isobaric and isochoric processes',
      'work done as area under a P–V curve',
      'kinetic theory — rms speed, degrees of freedom, specific heats',
      'second law, heat engines and efficiency'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-oscillations-waves',
    name: 'Oscillations and Waves',
    concepts: [
      'SHM — displacement, velocity, acceleration and energy relations',
      'simple pendulum, spring combinations and the time period',
      'wave equation, superposition, standing waves in strings and pipes',
      'beats and the Doppler effect'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-mole-concept',
    name: 'Some Basic Concepts of Chemistry (Mole Concept)',
    concepts: [
      'mole–mass–number interconversion and molar volume',
      'empirical and molecular formula from percentage composition',
      'limiting reagent and percentage yield in stoichiometry',
      'concentration terms — molarity, molality, mole fraction, and dilution'
    ],
    diagramEligible: false
  },
  {
    id: 'x11-jee-atomic-structure',
    name: 'Structure of Atom',
    concepts: [
      'Bohr model — radius, energy and the hydrogen spectrum series',
      'de Broglie relation and the Heisenberg uncertainty principle',
      'quantum numbers, orbital shapes and nodes',
      'Aufbau, Pauli and Hund rules, and exceptional configurations'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-bonding',
    name: 'Chemical Bonding and Molecular Structure',
    concepts: [
      'VSEPR theory and prediction of molecular geometry',
      'hybridisation and bond angles',
      'molecular orbital theory — bond order and magnetic behaviour',
      'dipole moment, hydrogen bonding and Fajans\' rules'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-equilibrium',
    name: 'Equilibrium (Chemical and Ionic)',
    concepts: [
      'Kc, Kp and their relationship, Le Chatelier\'s principle',
      'reaction quotient and the direction of shift',
      'pH of weak acids and bases, degree of dissociation, buffer solutions',
      'solubility product and the common ion effect'
    ],
    diagramEligible: false
  },
  {
    id: 'x11-jee-thermochem',
    name: 'Thermodynamics and Thermochemistry (Chemistry)',
    concepts: [
      'enthalpy of formation, combustion and Hess\'s law',
      'entropy change and spontaneity criteria',
      'Gibbs free energy and its relation to equilibrium constant',
      'bond enthalpy calculations'
    ],
    diagramEligible: false
  },
  {
    id: 'x11-jee-sets-functions',
    name: 'Sets, Relations and Functions',
    concepts: [
      'domain and range of composite and rational functions',
      'types of relations and functions — one-one, onto, inverse',
      'set operations, Venn diagrams and the counting principle',
      'graphs of modulus, greatest integer and piecewise functions'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-complex-quadratic',
    name: 'Complex Numbers and Quadratic Equations',
    concepts: [
      'modulus, argument and polar form, De Moivre\'s theorem',
      'cube roots of unity and their properties',
      'nature of roots, common roots and the range of a quadratic expression',
      'locus problems in the Argand plane'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-sequences',
    name: 'Sequences and Series',
    concepts: [
      'AP, GP, HP and the relation between AM, GM and HM',
      'sum of n terms of special series and telescoping sums',
      'infinite GP and its sum condition',
      'arithmetico-geometric progressions'
    ],
    diagramEligible: false
  },
  {
    id: 'x11-jee-trig-functions',
    name: 'Trigonometric Functions and Equations',
    concepts: [
      'compound, multiple and sub-multiple angle identities',
      'general solution of trigonometric equations',
      'sine rule, cosine rule and properties of triangles',
      'maximum and minimum of a cos θ + b sin θ'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-coordinate',
    name: 'Straight Lines and Conic Sections',
    concepts: [
      'forms of a straight line, angle between lines, family of lines',
      'circle — tangent, normal, chord of contact, orthogonality',
      'parabola, ellipse, hyperbola — standard equations, eccentricity, latus rectum',
      'tangents and normals to conics'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-limits-derivatives',
    name: 'Limits, Continuity and Derivatives',
    concepts: [
      'evaluation of limits — standard forms, L\'Hôpital-style algebraic manipulation',
      'continuity and differentiability at a point',
      'differentiation by product, quotient and chain rules',
      'application to tangents, normals and rate of change'
    ],
    diagramEligible: true
  },
  {
    id: 'x11-jee-permutations-binomial',
    name: 'Permutations, Combinations and Binomial Theorem',
    concepts: [
      'arrangements with restrictions, circular permutations',
      'combinations, selections and distribution problems',
      'general term, middle term and greatest coefficient in a binomial expansion',
      'summation of binomial coefficient series'
    ],
    diagramEligible: false
  }
];

const C11_JEE_EXEMPLARS = {
  tooEasy: 'What is the SI unit of force?',
  correct: 'A block of mass 2 kg is released from rest on a rough incline of 30° with μ = 0.2. Find its speed after sliding 4 m along the incline, using the work–energy theorem.',
  tooHard: 'Solve the three-body problem for a restricted circular configuration and derive the Lagrange points analytically.'
};

// ── Class 12 · NEET Biology ─────────────────────────────────────────────────

const C12_NEET_CHAPTERS = [
  {
    id: 'x12-neet-cell',
    name: 'Cell: The Unit of Life & Cell Cycle',
    concepts: [
      'ultrastructure of prokaryotic and eukaryotic cells, organelle functions',
      'fluid mosaic model of the plasma membrane and transport',
      'phases of the cell cycle and the events of mitosis',
      'meiosis I and II, crossing over and its significance'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-biomolecules',
    name: 'Biomolecules and Enzymes',
    concepts: [
      'structure and classification of carbohydrates, proteins, lipids and nucleic acids',
      'protein structure levels and denaturation',
      'enzyme action, active site and the induced-fit model',
      'factors affecting enzyme activity, inhibitors and cofactors'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-plant-physiology',
    name: 'Plant Physiology — Photosynthesis and Respiration',
    concepts: [
      'light reaction, cyclic and non-cyclic photophosphorylation, Z-scheme',
      'C3, C4 and CAM pathways and photorespiration',
      'glycolysis, TCA cycle, ETS and ATP accounting',
      'respiratory quotient and factors affecting photosynthesis'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-human-physiology-digestion-breathing',
    name: 'Human Physiology — Digestion and Breathing',
    concepts: [
      'alimentary canal, digestive glands and the enzymes at each site',
      'absorption and assimilation, disorders of the digestive system',
      'mechanism of breathing, respiratory volumes and capacities',
      'transport of O₂ and CO₂, oxygen dissociation curve and the Bohr effect'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-human-physiology-circulation-excretion',
    name: 'Human Physiology — Circulation and Excretion',
    concepts: [
      'structure of the human heart, cardiac cycle and the ECG',
      'double circulation, blood groups and coagulation',
      'nephron structure, ultrafiltration, reabsorption and secretion',
      'counter-current mechanism and regulation of kidney function (ADH, RAAS)'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-neural-chemical-control',
    name: 'Neural and Chemical Coordination',
    concepts: [
      'neuron, resting and action potential, synaptic transmission',
      'human brain regions and the reflex arc',
      'endocrine glands, their hormones and target effects',
      'mechanism of hormone action and disorders of hyper/hypo secretion'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-plant-reproduction',
    name: 'Sexual Reproduction in Flowering Plants',
    concepts: [
      'microsporogenesis, megasporogenesis and the embryo sac',
      'pollination types, outbreeding devices and pollen–pistil interaction',
      'double fertilisation, endosperm and embryo development',
      'apomixis, polyembryony and parthenocarpy'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-human-reproduction',
    name: 'Human Reproduction and Reproductive Health',
    concepts: [
      'male and female reproductive systems, gametogenesis',
      'menstrual cycle and its hormonal control',
      'fertilisation, implantation, placenta and parturition',
      'contraception, ART techniques (IVF, ZIFT, GIFT) and STDs'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-inheritance',
    name: 'Principles of Inheritance and Variation',
    concepts: [
      'Mendelian ratios, incomplete dominance, co-dominance and multiple allelism',
      'linkage, recombination and gene mapping',
      'sex determination and pedigree analysis',
      'Mendelian and chromosomal disorders — haemophilia, sickle-cell, Down\'s, Turner\'s'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-molecular-basis',
    name: 'Molecular Basis of Inheritance',
    concepts: [
      'DNA structure, the Hershey–Chase and Griffith experiments',
      'semi-conservative replication and the enzymes involved',
      'transcription in prokaryotes and eukaryotes, splicing',
      'genetic code, translation and the lac operon; Human Genome Project and DNA fingerprinting'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-evolution',
    name: 'Evolution',
    concepts: [
      'origin of life theories and evidences of evolution',
      'Darwinian selection, Hardy–Weinberg principle and its disturbances',
      'adaptive radiation, convergent and divergent evolution',
      'human evolution and the fossil sequence'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-health-disease',
    name: 'Human Health and Disease',
    concepts: [
      'pathogens and life cycles — malaria, filariasis, amoebiasis, ascariasis',
      'innate and acquired immunity, active versus passive immunity',
      'AIDS and cancer — causes, detection and treatment',
      'drugs, alcohol abuse and adolescent health'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-microbes-biotech',
    name: 'Microbes in Human Welfare and Biotechnology',
    concepts: [
      'microbes in household products, industrial products, sewage treatment and biogas',
      'restriction enzymes, vectors, cloning and the steps of rDNA technology',
      'PCR, gel electrophoresis and bioreactors',
      'applications — Bt crops, RNA interference, gene therapy, transgenic animals'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-ecology',
    name: 'Ecology — Organisms, Populations and Ecosystems',
    concepts: [
      'population attributes, growth models (exponential and logistic) and interactions',
      'ecosystem structure, productivity, decomposition and energy flow',
      'ecological pyramids and nutrient cycling',
      'ecological succession'
    ],
    diagramEligible: true
  },
  {
    id: 'x12-neet-biodiversity',
    name: 'Biodiversity and Conservation',
    concepts: [
      'levels and patterns of biodiversity, the species–area relationship',
      'causes of biodiversity loss — the evil quartet',
      'in-situ and ex-situ conservation strategies',
      'biodiversity hotspots and international conservation efforts'
    ],
    diagramEligible: false
  }
];

const C12_NEET_EXEMPLARS = {
  tooEasy: 'What is the powerhouse of the cell?',
  correct: 'A woman with blood group AB marries a man with blood group O. State the possible blood groups of their children with the genotypes, and explain why the AB phenotype demonstrates co-dominance rather than incomplete dominance.',
  tooHard: 'Derive the Michaelis–Menten equation from the steady-state assumption and discuss the King–Altman method for multi-substrate kinetics.'
};

// ── The blueprint table ─────────────────────────────────────────────────────
// grade → subject → subSubject ('' for flat subjects)

export const SYLLABUS_BLUEPRINT = {
  'Class 10': {
    'Science': {
      'Physics': {
        chapters: C10_PHYSICS_CHAPTERS,
        difficultyAnchor: `${C10} For physics, expect numerical problems that require a formula plus rearrangement, or a ray/circuit situation that must be reasoned through — not a unit or definition recall.`,
        exemplars: C10_SCIENCE_EXEMPLARS
      },
      'Chemistry': {
        chapters: C10_CHEMISTRY_CHAPTERS,
        difficultyAnchor: `${C10} For chemistry, expect balanced-equation reasoning, prediction of products, or an inference from a described observation — not "what is the symbol of sodium".`,
        exemplars: {
          tooEasy: 'What is the chemical formula of water?',
          correct: 'When a strip of zinc is dipped into copper sulphate solution, the blue colour fades. Write the balanced equation, identify the substance oxidised, and explain the observation using the reactivity series.',
          tooHard: 'Deduce the term symbols for the ground state of a d⁴ ion in an octahedral weak field.'
        }
      },
      'Biology': {
        chapters: C10_BIOLOGY_CHAPTERS,
        difficultyAnchor: `${C10} For biology, expect questions linking structure to function, tracing a pathway, or interpreting a cross — not naming a labelled part in isolation.`,
        exemplars: {
          tooEasy: 'Which organ pumps blood in the human body?',
          correct: 'A tall pea plant (Tt) is crossed with a dwarf plant (tt). Give the phenotypic ratio of the offspring and explain why the dwarf trait reappears even though it was absent in the tall parent.',
          tooHard: 'Explain the molecular mechanism of chemiosmotic ATP synthesis including the rotary catalysis of F₁F₀-ATPase.'
        }
      },
      'Combined': {
        chapters: C10_SCIENCE_COMBINED,
        difficultyAnchor: `${C10} Questions must be drawn from across physics, chemistry and biology, each requiring reasoning or a calculation rather than recall.`,
        exemplars: C10_SCIENCE_EXEMPLARS
      }
    },
    'Maths': {
      '': {
        chapters: C10_MATHS_CHAPTERS,
        difficultyAnchor: `${C10} A Class 10 Maths question must require at least two steps — apply a formula AND manipulate the result, or combine two results. A single substitution into a formula (for example "if r = 4, find the diameter") is a Class 6 question and is unusable here.`,
        exemplars: {
          tooEasy: 'If r = 4, find the diameter.',
          correct: 'Find the roots of 2x² − 5x + 3 = 0 by factorisation and state the nature of its roots using the discriminant.',
          tooHard: 'Prove the general solution of a cubic equation by Cardano\'s method.'
        }
      }
    },
    'English': {
      'Writing': {
        chapters: C10_ENG_WRITING_CHAPTERS,
        difficultyAnchor: `${C10} For English writing, the task must require the student to produce or plan connected prose in a specific format and register — not identify a plural or a spelling.`,
        exemplars: C10_ENGLISH_EXEMPLARS_WRITING
      },
      'Grammar': {
        chapters: C10_ENG_GRAMMAR_CHAPTERS,
        difficultyAnchor: `${C10} For English grammar, the item must turn on a rule that has an exception or a competing option — concord with an intervening phrase, backshift in reported speech, modal nuance — not "is/are" with a singular subject.`,
        exemplars: C10_ENGLISH_EXEMPLARS_GRAMMAR
      },
      'Reading': {
        chapters: C10_ENG_READING_CHAPTERS,
        difficultyAnchor: `${C10} For reading, the question must require inference, tone identification, or contextual vocabulary — not retrieval of a fact stated in the first line.`,
        exemplars: C10_ENGLISH_EXEMPLARS_READING
      },
      'Fusion': {
        chapters: C10_ENGLISH_FUSION,
        difficultyAnchor: `${C10} Questions must span writing, grammar and reading, each requiring application rather than recall.`,
        exemplars: C10_ENGLISH_EXEMPLARS_GRAMMAR
      }
    },
    'Social Science': {
      'History': {
        chapters: C10_HISTORY_CHAPTERS,
        difficultyAnchor: `${C10} For history, the question must require explanation of cause, consequence or contrast between groups/regions — not a date or a name.`,
        exemplars: C10_SST_EXEMPLARS
      },
      'Geography': {
        chapters: C10_GEOGRAPHY_CHAPTERS,
        difficultyAnchor: `${C10} For geography, the question must require linking a physical or economic factor to a distribution or a policy outcome — not naming the longest river.`,
        exemplars: {
          tooEasy: 'Which is the longest river in India?',
          correct: 'The iron and steel industry in India is concentrated in the Chhotanagpur plateau. Explain, with reference to two location factors, why this concentration developed, and state one reason why newer plants are being set up on the coast.',
          tooHard: 'Model the regional input–output linkages of the Indian steel sector using a Leontief matrix.'
        }
      },
      'Civics': {
        chapters: C10_CIVICS_CHAPTERS,
        difficultyAnchor: `${C10} For political science, the question must require applying a concept (power sharing, federalism, majoritarianism) to a described situation — not defining democracy.`,
        exemplars: {
          tooEasy: 'What is the full form of MP?',
          correct: 'Sri Lanka and Belgium both had linguistic diversity but very different outcomes. Identify the key difference in how each accommodated its minorities, and state which form of power sharing Belgium adopted.',
          tooHard: 'Critique Lijphart\'s consociational model against Horowitz\'s centripetalism using post-1990 African case data.'
        }
      },
      'Economics': {
        chapters: C10_ECONOMICS_CHAPTERS,
        difficultyAnchor: `${C10} For economics, the question must require comparing indicators, tracing a mechanism (credit, globalisation) or interpreting data — not defining GDP.`,
        exemplars: {
          tooEasy: 'What does GDP stand for?',
          correct: 'State A has a higher per capita income than State B, but State B has a higher literacy rate and lower infant mortality. Explain which state you would call more developed and why per capita income alone is an inadequate criterion.',
          tooHard: 'Derive the Solow growth model\'s steady state and discuss conditional convergence.'
        }
      },
      'Combined': {
        chapters: C10_SST_COMBINED,
        difficultyAnchor: `${C10} Questions must span history, geography, political science and economics, each requiring explanation or application rather than recall.`,
        exemplars: C10_SST_EXEMPLARS
      }
    },
    'Hindi': {
      '': {
        chapters: C10_HINDI_CHAPTERS,
        difficultyAnchor: `${C10} हिंदी के प्रश्न व्याकरण के नियम के प्रयोग, काव्य/गद्य के भाव-ग्रहण अथवा लेखन-प्रारूप पर आधारित हों — केवल शब्दार्थ या वर्तनी पर नहीं. The question must require applying a grammar rule or interpreting a passage, not recalling a single word meaning.`,
        exemplars: {
          tooEasy: '"पुस्तक" शब्द का बहुवचन क्या है?',
          correct: 'निम्नलिखित वाक्य का वाच्य परिवर्तन कीजिए और भेद बताइए: "मोहन से पत्र नहीं लिखा गया।" साथ ही स्पष्ट कीजिए कि यह भाववाच्य क्यों है, कर्मवाच्य क्यों नहीं।',
          tooHard: 'अपभ्रंश से खड़ी बोली तक ध्वनि-परिवर्तन की ऐतिहासिक प्रक्रिया का भाषावैज्ञानिक विश्लेषण कीजिए।'
        }
      }
    }
  },

  'Class 11': {
    'JEE': {
      '': {
        chapters: C11_JEE_CHAPTERS,
        difficultyAnchor: `${C11} A JEE-foundation question must combine at least two ideas — for example a force analysis followed by an energy argument, or a stoichiometry step followed by a concentration calculation. A question answerable by quoting one formula is below level.`,
        exemplars: C11_JEE_EXEMPLARS
      }
    }
  },

  'Class 12': {
    'NEET': {
      '': {
        chapters: C12_NEET_CHAPTERS,
        difficultyAnchor: `${C12} A NEET question must be assertion/application style — interpret a described experiment, trace a pathway, or work out a cross. Naming an organelle or a hormone in isolation is below level.`,
        exemplars: C12_NEET_EXEMPLARS
      }
    }
  }
};

// ── Lookup ──────────────────────────────────────────────────────────────────

// Case/whitespace-insensitive index built once from the table above, so lookups
// tolerate 'class 10' / 'Class 10' / 'CLASS  10' consistently with the taxonomy
// normalizers used everywhere else.
const INDEX = new Map();
for (const [grade, subjects] of Object.entries(SYLLABUS_BLUEPRINT)) {
  for (const [subject, subSubjects] of Object.entries(subjects)) {
    for (const [ss, entry] of Object.entries(subSubjects)) {
      INDEX.set(`${normalizeGrade(grade)}|${normalizeSubject(subject)}|${normalizeSubSubject(ss)}`, entry);
    }
  }
}

const key = (g, s, ss) => `${normalizeGrade(g)}|${normalizeSubject(s)}|${normalizeSubSubject(ss)}`;

/**
 * Look up the syllabus blueprint for a course identity.
 *
 * Fallback order:
 *   1. exact (grade, subject, subSubject)
 *   2. flat entry for the subject (legacy docs with subSubject === '')
 *   3. the subject's Fusion/Combined entry — a specific area we don't have yet
 *      is still better served by the whole-subject blueprint than by nothing
 *   4. null — caller must synthesise one (see resolveBlueprint in
 *      utils/diagnosticEngine.js, which generates chapters via Groq rather than
 *      falling back to hardcoded filler)
 *
 * Never throws; never invents chapter content.
 */
export function getBlueprint(grade, subject, subSubject = '') {
  const canon = canonicalSubject(subject);

  const exact = INDEX.get(key(grade, canon, subSubject));
  if (exact) return exact;

  const flat = INDEX.get(key(grade, canon, ''));
  if (flat) return flat;

  if (hasSubSubjects(canon)) {
    const fusion = INDEX.get(key(grade, canon, fusionSubSubjectFor(canon)));
    if (fusion) return fusion;
  }

  return null;
}

/** The generic cognitive-level anchor for a grade (used when no blueprint exists). */
export function gradeAnchor(grade) {
  const n = normalizeGrade(grade);
  const found = Object.keys(GRADE_LEVEL_ANCHORS).find((g) => normalizeGrade(g) === n);
  return found
    ? GRADE_LEVEL_ANCHORS[found]
    : 'School level appropriate to the stated grade. The question must require reasoning, not single-fact recall.';
}

/**
 * Resolve a roadmap day's topic to the blueprint chapter it came from.
 *
 * EXACT match first, then substring. The order is not cosmetic: a pure substring test
 * lets a short chapter name swallow a longer one — "Areas Related to Circles" matched
 * "Circles", which silently resolved the wrong chapter. Extracted here so the roadmap
 * graft and the module-quiz figure gate share ONE implementation; two copies of a rule
 * this subtle means a fix to one leaves the other wrong, which is how the sarvamClient
 * duplication went bad.
 *
 * Normalisation is injected rather than imported to keep this config module free of
 * util dependencies.
 */
export function chapterForTopic(blueprint, topic, normalize) {
  const needle = normalize(topic);
  if (!needle || !blueprint?.chapters?.length) return undefined;
  return blueprint.chapters.find((c) => normalize(c.name) === needle)
    || blueprint.chapters.find((c) => {
      const n = normalize(c.name);
      return n && (n.includes(needle) || needle.includes(n));
    });
}

/** Is this chapter one where a figure is often genuinely required? (Workstream D3) */
export function isDiagramEligible(chapter) {
  return !!(chapter && chapter.diagramEligible);
}

/**
 * Pick a representative spread of `n` chapters from a blueprint rather than
 * truncating to the first n — otherwise a 20-chapter blueprint would only ever
 * test the opening chapters of the syllabus.
 */
export function representativeChapters(chapters, n) {
  const list = Array.isArray(chapters) ? chapters.filter(Boolean) : [];
  if (list.length <= n || n <= 0) return list.slice();
  if (n === 1) return [list[Math.floor(list.length / 2)]];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  }
  return [...new Map(out.map((c) => [c.id, c])).values()];
}