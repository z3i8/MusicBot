// commands/bot.js
const chalk = require("chalk");
const ask = require("../util/prompt");
// IMPORTANT: Replace this with your actual Sequelize model path
const { Bot, BotChannel } = require("../../models");

/**
 * ➕ Adds a new Bot record.
 */
async function addBot() {
  console.log(chalk.yellow("\n--- Adding New Bot ---"));
  const data = await ask([
    { type: "input", name: "name", message: "Bot Name:" },
    { type: "input", name: "slug", message: "Slug (unique):" },
    { type: "input", name: "env_key", message: "Token key name in .env:" },
    { type: "input", name: "prefix", message: "Prefix:", default: "-" },
  ]);

  // Additional settings
  const settings = {};

  await Bot.create({
    name: data.name,
    slug: data.slug,
    env_key: data.env_key,
    prefix: data.prefix,
    settings,
  });

  console.log(chalk.green("✔ Bot added successfully!"));
}

/**
 * 📜 Lists all Bot records and their associated channels.
 */
async function listBots() {
  const bots = await Bot.findAll({ include: "channels" });

  console.log(chalk.yellow("\n--- Listing All Bots ---"));
  if (bots.length === 0) {
    console.log(chalk.yellow("⚠ No bots found."));
  } else {
    bots.forEach((bot) => {
      console.log(chalk.cyan(`\n---------------------------`));
      console.log(chalk.green(`ID: ${bot.id} | ${bot.name}`));
      console.log(chalk.white(`Slug: ${bot.slug}`));
      console.log(chalk.white(`Env Key: ${bot.env_key}`));
      console.log(chalk.white(`Prefix: ${bot.prefix}`));
      console.log(chalk.white(`Allowed Channels:`));

      if (bot.channels.length === 0) {
        console.log(chalk.gray("  - No channels added yet."));
      } else {
        bot.channels.forEach((ch) =>
          console.log(chalk.magenta(`  - ${ch.channel_id}`))
        );
      }
    });
  }
}

/**
 * 🗑️ Deletes a selected Bot and its associated channels.
 */
async function deleteBot() {
  const bots = await Bot.findAll();
  if (!bots.length) {
    return console.log(chalk.red("❌ No bots found."));
  }

  const { botId } = await ask([
    {
      type: "list",
      name: "botId",
      message: "Select a bot to delete:",
      choices: bots.map((b) => ({
        name: `${b.name} (${b.slug})`,
        value: b.id,
      })),
    },
  ]);

  await Bot.destroy({ where: { id: botId } });
  await BotChannel.destroy({ where: { bot_id: botId } });

  console.log(chalk.green("✔ Bot deleted completely."));
}

const SETTINGS_SCHEMA = {
  auto_join_guild: "string", // guild ID
  auto_join_channel: "string", // channel ID
  auto_lock_voice: "boolean", // مثال لو عندك Boolean
};

/**
 * ⚙️ Updates settings for a selected Bot.
 */
async function updateBot() {
  const bots = await Bot.findAll();
  if (!bots.length) {
    return console.log(chalk.red("❌ No bots found."));
  }

  const { botId } = await ask([
    {
      type: "list",
      name: "botId",
      message: "Select a bot to update:",
      choices: bots.map((b) => ({
        name: `${b.name} (${b.slug})`,
        value: b.id,
      })),
    },
  ]);

  const { field } = await ask([
    {
      type: "list",
      name: "field",
      message: "Select what you want to modify:",
      choices: ["Name", "Slug", "Env Key", "Prefix", "Settings"],
    },
  ]);

  let update = {};

  if (field === "Name") {
    const { value } = await ask([
      { type: "input", name: "value", message: "New Name:" },
    ]);
    update.name = value;
  } else if (field === "Slug") {
    const { value } = await ask([
      { type: "input", name: "value", message: "New Slug:" },
    ]);
    update.slug = value;
  } else if (field === "Env Key") {
    const { value } = await ask([
      { type: "input", name: "value", message: "New Env Key:" },
    ]);
    update.env_key = value;
  } else if (field === "Prefix") {
    const { value } = await ask([
      { type: "input", name: "value", message: "New Prefix:" },
    ]);
    update.prefix = value;
  } else if (field === "Settings") {
    const bot = await Bot.findByPk(botId);
    const currentSettings = bot.settings || {};

    const { settingField } = await ask([
      {
        type: "list",
        name: "settingField",
        message: "Which setting do you want to modify?",
        choices: [
          { name: "auto_join_guild (Guild ID)", value: "auto_join_guild" },
          {
            name: "auto_join_channel (Channel ID)",
            value: "auto_join_channel",
          },
          { name: "Replace all settings (JSON)", value: "raw" },
        ],
      },
    ]);

    // Raw JSON override
    if (settingField === "raw") {
      const { raw } = await ask([
        { type: "input", name: "raw", message: "Enter full settings JSON:" },
      ]);

      try {
        update.settings = JSON.parse(raw);
      } catch {
        console.log(chalk.red("❌ Invalid JSON."));
        return;
      }
      return;
    }

    // Determine setting type
    const type = SETTINGS_SCHEMA[settingField] || "string";

    // Handle string/ID inputs
    if (type === "string") {
      const { value } = await ask([
        {
          type: "input",
          name: "value",
          message: `Enter value for ${settingField}:`,
          default: currentSettings[settingField] || "",
        },
      ]);

      update.settings = {
        ...currentSettings,
        [settingField]: value,
      };
    }

    // Handle boolean inputs
    else if (type === "boolean") {
      const { value } = await ask([
        {
          type: "list",
          name: "value",
          message: `Set ${settingField}:`,
          choices: [
            { name: "True", value: true },
            { name: "False", value: false },
          ],
          default: currentSettings[settingField] ? 0 : 1,
        },
      ]);

      update.settings = {
        ...currentSettings,
        [settingField]: value,
      };
    }

    console.log(chalk.green("✔ Setting updated."));
  }
  await Bot.update(update, { where: { id: botId } });
  console.log(chalk.green("✔ Update successful."));
}

module.exports = {
  addBot,
  listBots,
  deleteBot,
  updateBot,
};
