"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("bots", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, allowNull: false, unique: true },
      env_key: { type: Sequelize.STRING, allowNull: false },
      prefix: { type: Sequelize.STRING, defaultValue: "-" },
      status: {
        type: Sequelize.ENUM("active", "disabled"),
        defaultValue: "active",
      },
      settings: { type: Sequelize.JSON, defaultValue: {} },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("bots");
  },
};
