const fs = require('fs');
const userDataPath = './userData.json';

module.exports = {
  name: 'inventory',
  description: 'View your caught demons!',
  async execute(message, args, demons) {
    const userId = message.author.id;

    // Load user data
    let userData = {};
    if (fs.existsSync(userDataPath)) {
      userData = JSON.parse(fs.readFileSync(userDataPath));
    }

    // If the user has no caught demons
    if (!userData[userId] || userData[userId].caughtDemons.length === 0) {
      return message.reply('You don\'t have any caught demons yet.');
    }

    const caughtDemons = userData[userId].caughtDemons;
    const uniqueDemons = [...new Set(caughtDemons)]; // Remove duplicates

    const demonNames = uniqueDemons.join(', ');

    await message.reply(`You have caught the following demons: ${demonNames}`);
  },
};
