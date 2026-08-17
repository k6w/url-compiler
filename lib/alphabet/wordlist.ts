/**
 * Frozen 256-word voice-mode list (spec §2 voice mode). One word = exactly
 * 8 bits. Words are short, lowercase, pronounceable, and chosen to be
 * phonetically distinct for dictation. This list is immutable — any change
 * requires a new codec version, never an edit here.
 */
const ALL_WORDS = Object.freeze([
  "acid", "acorn", "actor", "adapt", "after", "agent", "amber", "anchor",
  "angel", "ankle", "apple", "april", "arbor", "arena", "armor", "arrow",
  "ashen", "aspen", "atlas", "atom", "august", "autumn", "avenue", "bacon",
  "badge", "baker", "banjo", "barge", "basil", "beach", "beacon", "beetle",
  "berry", "betty", "bicycle", "birch", "bison", "blossom", "bonfire", "border",
  "bottle", "boulder", "brace", "brave", "bread", "breeze", "brick", "bronze",
  "brook", "bubble", "bucket", "buffalo", "cabin", "cactus", "camera", "candle",
  "canoe", "cargo", "carpet", "carrot", "castle", "cattle", "cedar", "cello",
  "chain", "chalk", "charm", "cheese", "cherry", "chess", "chili", "chimney",
  "chisel", "cider", "cinema", "circle", "citrus", "civil", "clamor", "clay",
  "clever", "cliff", "cloak", "cobble", "comet", "compass", "copper", "coral",
  "cosmos", "cotton", "country", "coyote", "cradle", "crayon", "creek", "crisp",
  "crown", "crystal", "cupcake", "curtain", "cyclic", "daisy", "dancer", "decoy",
  "denim", "diamond", "dinner", "dipper", "dock", "dolphin", "domino", "donkey",
  "dragon", "dream", "drift", "durian", "eagle", "earth", "easel", "echo",
  "eclair", "edger", "eight", "elbow", "elder", "ember", "engine", "enigma",
  "envelope", "equal", "ethanol", "evening", "exhibit", "fabric", "falcon", "family",
  "famous", "fast", "feather", "fence", "fern", "ferry", "fiber", "fiddle",
  "fifty", "fig", "filter", "finch", "firefly", "fisher", "flag", "flannel",
  "flex", "florist", "flute", "foggy", "forest", "founder", "fox", "fragile",
  "freckle", "friday", "frontier", "frost", "fudge", "funnel", "gadget", "galaxy",
  "gallery", "garage", "garden", "garlic", "gemini", "gentle", "geyser", "ginger",
  "giraffe", "glacier", "glide", "glisten", "glove", "goldfish", "gopher", "granite",
  "grape", "gravel", "greet", "griffin", "groove", "gumbo", "habit", "hammock",
  "harbor", "harmony", "hat", "hazel", "heather", "hedge", "helium", "herald",
  "hidden", "hiking", "hobby", "hollow", "honey", "hoodie", "horizon", "hornet",
  "horse", "hotel", "huddle", "human", "hummingbird", "hunter", "hurry", "iceberg",
  "igloo", "impact", "incense", "indigo", "inland", "invent", "iris", "iron",
  "island", "ivory", "jacket", "jaguar", "jelly", "jersey", "jewel", "jigsaw",
  "jockey", "jolly", "july", "jumbo", "jungle", "junior", "juniper", "kabob",
  "kayak", "keen", "ketchup", "kettle", "keyboard", "kidney", "kindle", "kingdom",
  "kiosk", "kitten", "kiwi", "knapsack", "knight", "koala", "labor", "lagoon",
  "lamp", "lantern", "laptop", "lasso", "latch", "laurel", "lava", "lavender",
  "leaf", "ledge", "legend", "lemon", "level", "libretto", "lilac", "limerick",
  "linen", "lion", "liquid", "lizard", "lobster", "local", "locker", "lodge",
  "logbook", "lotus", "lounge", "loyal", "lucid", "lumber", "lunar", "lyric",
  "macaw", "magenta", "magnet", "mailbox", "mango", "mantle", "maple", "marble",
  "margin", "marina", "marlon", "mascot", "matrix", "mayor", "meadow", "mellow",
  "melody", "mentor", "meteor", "miller", "mimic", "mineral", "mint", "mirror",
  "misty", "mocha", "monday", "monsoon", "moon", "morning", "moss", "motto",
  "mountain", "muffin", "mulberry", "muscle", "museum", "music", "mustard", "mutter",
  "napkin", "narrow", "nation", "natural", "nebula", "nectar", "needle", "neon",
  "nestle", "network", "neutral", "newt", "nickel", "nimble", "ninja", "noble",
  "nomad", "noodle", "north", "notch", "novel", "nozzle", "nugget", "number",
  "nurse", "nutmeg", "oasis", "oatmeal", "oblong", "ocelot", "octave", "october",
  "office", "olive", "omega", "onion", "onward", "opal", "opera", "orange",
  "orbit", "orchid", "organic", "osprey", "ostrich", "otter", "ounce", "outdoor",
  "oval", "owl", "oyster", "pacific", "paddle", "pagoda", "painter", "palm",
  "pamphlet", "panel", "papaya", "parade", "parcel", "parsley", "pastel", "pastry",
  "path", "patio", "peaceful", "pebble", "pelican", "pencil", "penguin", "people",
  "pepper", "perfume", "petal", "phantom", "phone", "photo", "phrase", "piano",
  "pickle", "picnic", "pilot", "pineapple", "pistol", "pixel", "planet", "plank",
  "plaza", "plum", "plush", "poetry", "polar", "poncho", "popcorn", "porch",
  "poster", "potato", "powder", "praise", "pretzel", "printer", "prism", "proud",
  "pudding", "puffin", "pulley", "pumpkin", "punch", "puppy", "purple", "puzzle",
] as const)

export const VOICE_WORDS: readonly string[] = Object.freeze(ALL_WORDS.slice(0, 256))

const INDEX = new Map<string, number>(VOICE_WORDS.map((w, i) => [w, i]))

export function voiceWord(index: number): string {
  return VOICE_WORDS[index]
}

export function voiceIndex(word: string): number | undefined {
  return INDEX.get(word)
}
