const dataManager = require('../utils/DataManager');

module.exports = {
  name: 'inventory',
  description: 'View your caught demons!',
  async execute(message, args) {
    const userId = message.author.id;
    const userDemons = await dataManager.getUserDemons(userId);

    if (!userDemons.length) {
      return message.reply('You don\'t have any caught demons yet.');
    }

    const uniqueDemons = [...new Set(userDemons)];
    const demonNames = uniqueDemons.join(', ');

    await message.reply(`You have caught the following demons: ${demonNames}`);
  },
};
