const dataManager = require('../utils/DataManager');

module.exports = {
  name: 'encounter',
  description: 'Encounter and attempt to catch a random demon!',
  async execute(message, args) {
    const demons = await dataManager.getDemons();
    const demonList = Object.keys(demons);

    // Pick a random demon
    const randomDemonName = demonList[Math.floor(Math.random() * demonList.length)];
    const randomDemon = demons[randomDemonName];

    const userId = message.author.id;
    const userDemons = await dataManager.getUserDemons(userId);

    // Check if the demon is already caught
    if (userDemons.includes(randomDemon.name)) {
      return message.reply(`You already caught a ${randomDemon.name}. No need to catch it again!`);
    }

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
