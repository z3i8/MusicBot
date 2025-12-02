// commands/channel.js
const chalk = require("chalk");
const ask = require("../util/prompt");
// IMPORTANT: Replace this with your actual Sequelize model path
const { Bot, BotChannel } = require("../../models"); 

/**
 * ➕ Adds channel IDs to a selected Bot.
 */
async function addChannels() {
    const bots = await Bot.findAll();
    if (!bots.length) {
        return console.log(chalk.red("❌ No bots found."));
    }

    const { botId } = await ask([
        {
            type: "list",
            name: "botId",
            message: "Select a bot to add channels to:",
            choices: bots.map((b) => ({
                name: `${b.name} (${b.slug})`,
                value: b.id,
            })),
        },
    ]);

    const { channels } = await ask([
        {
            type: "input",
            name: "channels",
            message: "Enter Channel IDs (separate with a comma ,):",
        },
    ]);

    const list = channels.split(",").map((c) => c.trim()).filter(c => c.length > 0);

    // Create channel entries in the database
    for (const channelId of list) {
        // Simple check to avoid duplicates, although uniqueness should be handled by the model
        await BotChannel.findOrCreate({ 
            where: { bot_id: botId, channel_id: channelId },
            defaults: { bot_id: botId, channel_id: channelId }
        });
    }

    console.log(chalk.green(`✔ Added ${list.length} channels.`));
}

module.exports = {
    addChannels,
};