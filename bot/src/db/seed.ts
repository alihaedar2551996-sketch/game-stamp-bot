import { db } from "./client";

const GAMES = [
  { name: "Match Factory",           emoji: "🏭" },
  { name: "Yarn Loop",               emoji: "🧶" },
  { name: "Royal Kingdom",           emoji: "👑" },
  { name: "Board Adventure",         emoji: "🎲" },
  { name: "Coin Master",             emoji: "🪙" },
  { name: "Disney Solitaire",        emoji: "🏰" },
  { name: "Toon Blast",              emoji: "💥" },
  { name: "Screw Guru",              emoji: "🔩" },
  { name: "Empires",                 emoji: "⚔️" },
  { name: "Zombie Miner",            emoji: "🧟" },
  { name: "Family Island",           emoji: "🏝️" },
  { name: "Domino Dreams",           emoji: "🎯" },
  { name: "Goods Master 3D",         emoji: "📦" },
  { name: "Travel Town",             emoji: "✈️" },
  { name: "Dice Dreams",             emoji: "🎲" },
  { name: "Matching Story",          emoji: "🃏" },
  { name: "Toy Blast",               emoji: "🧸" },
  { name: "Solitaire Grand Harvest", emoji: "🌾" },
  { name: "FarmVille 3",             emoji: "🚜" },
  { name: "Box Jam",                 emoji: "📫" },
  { name: "Glow Tales",              emoji: "✨" },
  { name: "Soliter Stash",           emoji: "💎" },
  { name: "Solitaire Cash",          emoji: "💵" },
  { name: "Phase 10",                emoji: "🔟" },
  { name: "Love & Fashion",          emoji: "👗" },
  { name: "Cash Legends",            emoji: "💰" },
  { name: "Royal Match",             emoji: "👸" },
  { name: "Klondike",                emoji: "🏔️" },
  { name: "Unravel Master",          emoji: "🧵" },
  { name: "June's Journey",          emoji: "🔍" },
  { name: "IdleOutpost",             emoji: "🏕️" },
  { name: "Solitaire Smash",         emoji: "🃏" },
  { name: "Merge Sweets",            emoji: "🍬" },
  { name: "Merge Mansion",           emoji: "🏚️" },
  { name: "MergeDragons! Power",     emoji: "🐉" },
  { name: "MergeDragons! Level",     emoji: "🐲" },
  { name: "Screw Tap Jam",           emoji: "🔧" },
  { name: "Sort Journey",            emoji: "🗂️" },
  { name: "Immortal",                emoji: "⚡" },
];

export async function seedGames() {
  const existing = await db.execute(`SELECT COUNT(*) as cnt FROM games`);
  if (Number(existing.rows[0].cnt) > 0) {
    console.log("⏭️ Games already seeded");
    return;
  }
  for (const game of GAMES) {
    await db.execute({
      sql: `INSERT INTO games (name, emoji) VALUES (?, ?)`,
      args: [game.name, game.emoji],
    });
  }
  console.log(`✅ Seeded ${GAMES.length} games`);
}
