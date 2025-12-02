module.exports = (sequelize, DataTypes) => {
  const Bot = sequelize.define(
    "Bot",
    {
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      env_key: { type: DataTypes.STRING, allowNull: false },
      prefix: { type: DataTypes.STRING, defaultValue: "-" },
      status: {
        type: DataTypes.ENUM("active", "disabled"),
        defaultValue: "active",
      },
      settings: { type: DataTypes.JSON, defaultValue: {} },
    },
    {
      tableName: "bots",
      timestamps: true,
    }
  );

  Bot.associate = (models) => {
    Bot.hasMany(models.BotChannel, {
      as: "channels",
      foreignKey: "bot_id",
      onDelete: "CASCADE",
    });
  };

  return Bot;
};
