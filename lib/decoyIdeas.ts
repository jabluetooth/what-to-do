/** Purely decorative idea titles — what the full-screen reel flicks through while the real idea is
 *  being generated, and what the hero's background marquee scrolls. Never submitted anywhere. */
export const DECOY_TITLES = [
  "Plant Doctor",
  "Chore Wars",
  "Split The Bill",
  "Gig Radar",
  "Pantry Chef",
  "Study Buddy",
  "Habit Forge",
  "Pet Passport",
  "Rent Pulse",
  "Mood Journal",
  "Trail Mates",
  "Invoice Nudge",
  "Crate Digger",
  "Lease Lens",
  "Swap Shelf",
  "Focus Den",
  "Garage Band",
  "Meal Roulette",
  "Tab Tamer",
  "Side Quest",
  "Closet Swap",
  "Bug Bounty",
  "Night Owl",
  "Recipe Remix",
  "Commute Pal",
  "Tool Library",
  "Book Club",
  "Budget Buddy",
];

/**
 * Font size that lets `text` sit at poster scale without a single word overflowing the viewport.
 * Sized off the longest word (Anton's uppercase glyphs average roughly half an em wide) and
 * capped by viewport height by overall length, so short titles go huge and long ones still fit
 * on a phone.
 */
export function posterFontSize(text: string): string {
  const longestWord = Math.max(...text.split(/\s+/).map((w) => w.length), 1);
  const vw = Math.min(19, 86 / (longestWord * 0.52));
  const vh = text.length > 26 ? 12 : text.length > 16 ? 16 : 22;
  return `min(${vw.toFixed(2)}vw, ${vh}vh)`;
}
