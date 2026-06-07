import { db } from "./client";

const GAMES = [
  { name: "Match Factory",          emoji: "🏭", stages: 15 },
  { name: "Yarn Loop",              emoji: "🧶", stages: 15 },
  { name: "Royal Kingdom",          emoji: "👑", stages: 15 },
  { name: "Board Adventure",        emoji: "🎲", stages: 15 },
  { name: "Coin Master",            emoji: "🪙", stages: 15 },
  { name: "Disney Solitaire",       emoji: "🏰", stages: 15 },
  { name: "Toon Blast",             emoji: "💥", stages: 15 },
  { name: "Screw Guru",             emoji: "🔩", stages: 15 },
  { name: "Empires",                emoji: "⚔️", stages: 15 },
  { name: "Zombie Miner",           emoji: "🧟", stages: 15 },
  { name: "Family Island",          emoji: "🏝️", stages: 15 },
  { name: "Domino Dreams",          emoji: "🁣",  stages: 15 },
  { name: "Goods Master 3D",        emoji: "📦", stages: 15 },
  { name: "Travel Town",            emoji: "✈️", stages: 15 },
  { name: "Dice Dreams",            emoji: "🎲", stages: 15 },
  { name: "Matching Story",         emoji: "🃏", stages: 15 },
  { name: "Toy Blast",              emoji: "🧸", stages: 15 },
  { name: "Solitaire Grand Harvest",emoji: "🌾", stages: 15 },
  { name: "FarmVille 3",            emoji: "🚜", stages: 15 },
  { name: "Box Jam",                emoji: "📫", stages: 15 },
  { name: "Glow Tales",             emoji: "✨", stages: 15 },
  { name: "Soliter Stash",          emoji: "💎", stages: 15 },
  { name: "Solitaire Cash",         emoji: "💵", stages: 15 },
  { name: "Phase 10",               emoji: "🔟", stages: 15 },
  { name: "Love & Fashion",         emoji: "👗", stages: 15 },
  { name: "Cash Legends",           emoji: "💰", stages: 15 },
  { name: "Royal Match",            emoji: "🃏", stages: 15 },
  { name: "Klondike",               emoji: "🏔️", stages: 15 },
  { name: "Unravel Master",         emoji: "🧵", stages: 15 },
  { name: "June's Journey",         emoji: "🔍", stages: 15 },
  { name: "IdleOutpost",            emoji: "🏕️", stages: 15 },
  { name: "Solitaire Smash",        emoji: "🃏", stages: 15 },
  { name: "Merge Sweets",           emoji: "🍬", stages: 15 },
  { name: "Merge Mansion",          emoji: "🏚️", stages: 15 },
  { name: "MergeDragons! Power",    emoji: "🐉", stages: 15 },
  { name: "MergeDragons! Level",    emoji: "🐲", stages: 15 },
  { name: "Screw Tap Jam",          emoji: "🔧", stages: 15 },
  { name: "Sort Journey",           emoji: "🗂️", stages: 15 },
  { name: "Immortal",               emoji: "⚡", stages: 15 },
];

export async function seedGames() {
  const existing = await db.execute(`SELECT COUNT(*) as cnt FROM games`);
  if (Number(existing.rows[0].cnt) > 0) {
    console.log("⏭️ Games already seeded");
    return;
  }

  for (const game of GAMES) {
    const res = await db.execute({
      sql: `INSERT INTO games (name, emoji, total_stages) VALUES (?, ?, ?)`,
      args: [game.name, game.emoji, game.stages],
    });
    const gameId = Number(res.lastInsertRowid);

    for (let i = 1; i <= game.stages; i++) {
      await db.execute({
        sql: `INSERT INTO stages (game_id, number, name) VALUES (?, ?, ?)`,
        args: [gameId, i, `المرحلة ${i}`],
      });
    }
  }
  console.log(`✅ Seeded ${GAMES.length} games`);
}
