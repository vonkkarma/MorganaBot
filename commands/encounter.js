const fs = require('fs');
const userDataPath = './userData.json';

module.exports = {
  name: 'encounter',
  description: 'Encounter and attempt to catch a random demon!',
  async execute(message, args, demons) {
    const demonList = Object.keys(demons);

    // Pick a random demon
    const randomDemonName = demonList[Math.floor(Math.random() * demonList.length)];
    const randomDemon = demons[randomDemonName];

    // Show demon info
    const demonInfo = `**You encountered a wild ${randomDemon.name}!**`;


    // Load user data
    let userData = {};
    if (fs.existsSync(userDataPath)) {
      userData = JSON.parse(fs.readFileSync(userDataPath));
    }

    const userId = message.author.id;

    // If the user has no entry, create one
    if (!userData[userId]) {
      userData[userId] = { caughtDemons: [] };
    }

    // Check if the demon is already caught
    if (userData[userId].caughtDemons.includes(randomDemon.name)) {
      return message.reply(`You already caught a ${randomDemon.name}. No need to catch it again!`);
    }

    
    const requiredChance = 100 * Math.pow(2, -0.09 * randomDemon.level);
    
    // Generate the random number and check if the catch is successful
    const catchChance = Math.random() * 100;

    if (catchChance < requiredChance) {
      // Add the demon to the user's list
      userData[userId].caughtDemons.push(randomDemon.name);

      // Save the updated user data
      fs.writeFileSync(userDataPath, JSON.stringify(userData, null, 2));

      return message.reply(`🎉 You successfully caught ${randomDemon.name}!`);
    } else {
      return message.reply(`😢 The catch attempt failed! ${randomDemon.name} escaped!`);
    }
  }
};
