'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert("bots", [
      {
        name: "Music Bot 1",
        slug: "music1",
        env_key: "BOT_MUSIC_1_TOKEN",
        prefix: "-",
        status: "active",
        settings: JSON.stringify({
          auto_join_guild: "your_guild_id",
          auto_join_channel: "your_channel_id"
        }),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("bots", null, {});
  }
};