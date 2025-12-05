const { fork } = require("child_process");
const path = require("path");
const { Bot, BotChannel } = require("./models");

async function startBot(botRow) {
  const worker = fork(path.join(__dirname, "bots/bot-worker.js"));

  worker.send(botRow.toJSON());

  worker.on("message", (msg) => {
    if (msg.type === "online") {
      console.log(`🟢 Bot ${msg.slug} is online`);
    }
  });

  worker.on("exit", (code) => {
    console.log(`🔴 Bot ${botRow.slug} exited with code ${code}`);
    console.log("Restarting bot...");
    setTimeout(() => startBot(botRow), 2000);
  });
}

(async () => {
  console.log("🚀 Starting Multi-Bot Supervisor...");

  const bots = await Bot.findAll({
    where: { status: "active" },
    include: { model: BotChannel, as: "channels" },
  });

  if (!bots.length) {
    console.log("⚠️ No active bots found in database.");
    return;
  }

  for (const botRow of bots) {
    await startBot(botRow);
  }
})();