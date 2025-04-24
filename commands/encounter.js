const dataManager = require('../utils/DataManager');

module.exports = {
  name: 'encounter',
  description: 'Encounter and attempt to catch a random demon!',
  async execute(message, args) {
    const demons = await dataManager.getDemons();
    const demonList = Object.keys(demons);

    const userId = message.author.id;
    const userDemons = await dataManager.getUserDemons(userId);

    // Filter out demons already caught by the user
    const availableDemons = demonList.filter(name => !userDemons.includes(demons[name].name));

    if (availableDemons.length === 0) {
      return message.reply("You have already caught all available demons!");
    }

    // Pick a random demon from the available ones
    const randomDemonName = availableDemons[Math.floor(Math.random() * availableDemons.length)];
    const randomDemon = demons[randomDemonName];

    const requiredChance = 100 * Math.pow(2, -0.045 * randomDemon.level);
    const catchChance = Math.random() * 100;

    if (catchChance < requiredChance) {
      // Add the demon to the user's list
      await dataManager.addUserDemon(userId, randomDemon.name);
      return message.reply(`🎉 You successfully caught ${randomDemon.name}!`);
    } else {
      return message.reply(`😢 The catch attempt failed! ${randomDemon.name} escaped!`);
    }
  }
};
