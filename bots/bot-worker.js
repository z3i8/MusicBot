// bots/bot-worker.js
const runSingleBot = require("../single-bot-runner");

process.on("message", async (botRow) => {
  try {
    console.log(`[Worker] Starting bot: ${botRow.slug}`);

    await runSingleBot(botRow);

    process.send?.({ type: "online", slug: botRow.slug });
  } catch (error) {
    console.error(`[Worker] Bot ${botRow.slug} crashed:`, error);
    process.exit(1);
  }
});