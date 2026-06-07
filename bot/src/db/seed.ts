// Seed 30 games with stages
import { db } from "./client";

const GAMES = [
  { name: "Minecraft", emoji: "⛏️", stages: 5 },
  { name: "Fortnite", emoji: "🔫", stages: 4 },
  { name: "Among Us", emoji: "🚀", stages: 3 },
  { name: "Roblox", emoji: "🧱", stages: 6 },
  { name: "Valorant", emoji: "🎯", stages: 5 },
  { name: "FIFA", emoji: "⚽", stages: 4 },
  { name: "GTA V", emoji: "🚗", stages: 7 },
  { name: "Call of Duty", emoji: "🪖", stages: 5 },
  { name: "League of Legends", emoji: "🏆", stages: 6 },
  { name: "Apex Legends", emoji: "🦅", stages: 4 },
  { name: "Overwatch", emoji: "🦸", stages: 5 },
  { name: "Dota 2", emoji: "🌑", stages: 6 },
  { name: "CS:GO", emoji: "💣", stages: 5 },
  { name: "Rocket League", emoji: "🚀", stages: 4 },
  { name: "Clash of Clans", emoji: "🏰", stages: 8 },
  { name: "PUBG", emoji: "🪂", stages: 5 },
  { name: "Free Fire", emoji: "🔥", stages: 4 },
  { name: "Genshin Impact", emoji: "🌸", stages: 7 },
  { name: "Candy Crush", emoji: "🍬", stages: 10 },
  { name: "Subway Surfers", emoji: "🛹", stages: 3 },
  { name: "Clash Royale", emoji: "👑", stages: 6 },
  { name: "Mobile Legends", emoji: "⚔️", stages: 5 },
  { name: "PUBG Mobile", emoji: "📱", stages: 5 },
  { name: "Brawl Stars", emoji: "⭐", stages: 4 },
  { name: "Hearthstone", emoji: "🃏", stages: 5 },
  { name: "World of Warcraft", emoji: "🧙", stages: 8 },
  { name: "Pokémon GO", emoji: "🎮", stages: 6 },
  { name: "Angry Birds", emoji: "🐦", stages: 4 },
  { name: "Temple Run", emoji: "🏃", stages: 3 },
  { name: "8 Ball Pool", emoji: "🎱", stages: 4 },
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
