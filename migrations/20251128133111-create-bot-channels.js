'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("bot_channels", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      bot_id: { type: Sequelize.INTEGER, allowNull: false },
      channel_id: { type: Sequelize.STRING, allowNull: false },
      createdAt: { type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("bot_channels");
  }
};