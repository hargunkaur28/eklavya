import crypto from 'crypto';

// Phase 3: generate a memorable, word-based temporary password for parent access.
// Format: 3 Title-cased words + 1 symbol + a 4-digit number, e.g. "TigerCloudRiver#4728".
// - Picks use crypto.randomInt (CSPRNG), NEVER Math.random.
// - Fully independent random — NEVER derived from the student's name/email/password.
// - Format guarantees the Phase 4 policy: length >= 8, an uppercase letter (word
//   capitalization), a number (suffix), and a symbol.
//
// Combination space: WORDS^3 * SYMBOLS * 9000  (~1.2e12 ≈ ~40 bits with 256 words).
// The password is temporary (force-changed on first login), bcrypt-hashed, and
// login is rate-limited (Phase 4), so this is comfortably hard to brute-force.

const WORDS = [
  'tiger', 'river', 'cloud', 'mango', 'planet', 'rocket', 'forest', 'bridge', 'garden', 'castle',
  'dragon', 'pencil', 'jungle', 'meadow', 'harbor', 'comet', 'maple', 'otter', 'falcon', 'coral',
  'breeze', 'pebble', 'willow', 'lantern', 'marble', 'copper', 'velvet', 'ember', 'thunder', 'orchid',
  'panda', 'eagle', 'lotus', 'cedar', 'canyon', 'glacier', 'meteor', 'saffron', 'cactus', 'walnut',
  'badger', 'heron', 'ginger', 'pepper', 'cobalt', 'indigo', 'crimson', 'amber', 'olive', 'ivory',
  'onyx', 'quartz', 'topaz', 'garnet', 'jasper', 'opal', 'pearl', 'seashell', 'basil', 'clover',
  'daisy', 'poppy', 'tulip', 'lily', 'fern', 'ivy', 'moss', 'reed', 'birch', 'alder',
  'spruce', 'aspen', 'poplar', 'hazel', 'rowan', 'holly', 'laurel', 'myrtle', 'sage', 'thyme',
  'mint', 'clove', 'nutmeg', 'cocoa', 'honey', 'butter', 'almond', 'cashew', 'peanut', 'raisin',
  'apricot', 'cherry', 'plum', 'peach', 'lemon', 'lime', 'melon', 'grape', 'berry', 'guava',
  'papaya', 'lychee', 'banana', 'coconut', 'pumpkin', 'carrot', 'potato', 'tomato', 'radish', 'turnip',
  'beetle', 'cricket', 'firefly', 'ladybug', 'dragonfly', 'sparrow', 'robin', 'swallow', 'magpie', 'raven',
  'crane', 'stork', 'pigeon', 'parrot', 'toucan', 'penguin', 'puffin', 'seagull', 'pelican', 'flamingo',
  'dolphin', 'whale', 'walrus', 'seal', 'octopus', 'lobster', 'shrimp', 'oyster', 'clam', 'starfish',
  'turtle', 'lizard', 'gecko', 'iguana', 'cobra', 'python', 'viper', 'salmon', 'trout', 'guppy',
  'tuna', 'marlin', 'anchor', 'compass', 'beacon', 'wharf', 'sailor', 'voyage', 'island', 'lagoon',
  'glade', 'valley', 'summit', 'ridge', 'cliff', 'boulder', 'geyser', 'crater', 'delta', 'oasis',
  'desert', 'dune', 'tundra', 'prairie', 'savanna', 'thicket', 'grove', 'orchard', 'vineyard', 'pasture',
  'cottage', 'cabin', 'tower', 'turret', 'archway', 'driftwood', 'candle', 'torch', 'hearth', 'chimney',
  'kettle', 'teapot', 'saucer', 'ladle', 'skillet', 'basket', 'satchel', 'pouch', 'ribbon', 'button',
  'thimble', 'needle', 'spindle', 'shuttle', 'anvil', 'hammer', 'chisel', 'wrench', 'pulley', 'gearbox',
  'engine', 'piston', 'turbine', 'magnet', 'circuit', 'lighthouse', 'signal', 'antenna', 'satellite', 'orbit',
  'galaxy', 'nebula', 'quasar', 'meteorite', 'asteroid', 'eclipse', 'aurora', 'zenith', 'horizon', 'twilight',
  'sunrise', 'sunset', 'monsoon', 'blizzard', 'cyclone', 'drizzle', 'frost', 'icicle', 'snowdrift', 'rainbow',
  'nickel', 'bronze', 'silver', 'platinum', 'granite', 'slate', 'flint', 'obsidian', 'gravel', 'crystal',
  'pecan', 'chestnut', 'acorn', 'pinecone', 'seedling', 'sapling', 'blossom', 'petal', 'nectar', 'pollen'
];

const SYMBOLS = ['@', '#', '$', '%', '&', '!', '?', '*'];

export function generateTempPassword() {
  const pick = (arr) => arr[crypto.randomInt(arr.length)];
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const words = [pick(WORDS), pick(WORDS), pick(WORDS)].map(cap).join('');
  const symbol = pick(SYMBOLS);
  const number = crypto.randomInt(1000, 10000); // 4-digit: 1000–9999
  return `${words}${symbol}${number}`;
}

export const WORD_BANK_SIZE = WORDS.length;
