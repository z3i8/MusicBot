const { Events } = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");
const chalk = require("chalk");

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {

    const client = newState.client;

    const settings = client.config.settings || {};
    const targetGuildId = settings.auto_join_guild;
    const targetChannelId = settings.auto_join_channel;

    if (!targetGuildId || !targetChannelId) return;

    const isBot = newState.member?.id === client.user.id;
    if (!isBot) return;

    const guild = client.guilds.cache.get(targetGuildId);
    if (!guild) return;

    const targetChannel = guild.channels.cache.get(targetChannelId);
    if (!targetChannel) return;

    const leftChannel = oldState.channelId && !newState.channelId;
    const movedChannel = newState.channelId && newState.channelId !== targetChannelId;

    if (leftChannel || movedChannel) {

      console.log(chalk.yellow(`↪ Bot disconnected or moved. Rejoining ${targetChannelId}`));

      try {
        joinVoiceChannel({
          channelId: targetChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        console.log(chalk.green("🔄 Bot rejoined the main channel."));
      } catch (err) {
        console.log(chalk.red("❌ Failed to rejoin channel:"), err.message);
      }
    }
  },
};