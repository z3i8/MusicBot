module.exports = (sequelize, DataTypes) => {
  const BotChannel = sequelize.define('BotChannel', {
    bot_id: { type: DataTypes.INTEGER, allowNull: false },
    channel_id: { type: DataTypes.STRING, allowNull: false }
  }, {
    tableName: "bot_channels"
  });

  BotChannel.associate = (models) => {
    BotChannel.belongsTo(models.Bot, {
      foreignKey: "bot_id",
      as: "bot"
    });
  };

  return BotChannel;
};