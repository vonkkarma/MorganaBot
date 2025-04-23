const dataManager = require('../utils/DataManager');

module.exports = {
  name: 'release',
  description: 'Release a demon from your collection.',
  async execute(message, args) {
    if (!args.length) {
      return message.reply('Please specify the demon name you want to release.');
    }

    const demonName = args.join(' ').toLowerCase();
    const userId = message.author.id;
    const userDemons = await dataManager.getUserDemons(userId);

    // Check if user has the demon (case insensitive)
    if (!userDemons.some(demon => demon.toLowerCase() === demonName)) {
      return message.reply(`You don't have a ${demonName} in your collection.`);
    }

    // Find the actual demon name with correct case
    const actualDemonName = userDemons.find(demon => demon.toLowerCase() === demonName);
    
    // Remove the demon
    await dataManager.removeUserDemon(userId, actualDemonName);
    return message.reply(`You have released ${actualDemonName}.`);
  },
};
