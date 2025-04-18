const fs = require('fs');
const userDataPath = './userData.json';

module.exports = {
  name: 'release',
  description: 'Release a demon from your collection.',
  async execute(message, args, demons) {
    if (!args.length) {
      return message.reply('Please specify the demon name you want to release.');
    }

    // Sanitize and get the demon name (convert to lowercase)
    const demonName = args.join(' ').toLowerCase();

    // Load user data
    let userData = {};
    if (fs.existsSync(userDataPath)) {
      userData = JSON.parse(fs.readFileSync(userDataPath));
    }

    const userId = message.author.id;

    // If the user has no demons or the specified demon doesn't exist (case insensitive check)
    if (!userData[userId] || !userData[userId].caughtDemons.some(demon => demon.toLowerCase() === demonName)) {
      return message.reply(`You don't have a ${demonName} in your collection.`);
    }

    // Remove the demon from the user's caught demons list (case insensitive)
    userData[userId].caughtDemons = userData[userId].caughtDemons.filter(demon => demon.toLowerCase() !== demonName);

    // Save the updated user data
    fs.writeFileSync(userDataPath, JSON.stringify(userData, null, 2));

    return message.reply(`You have released ${demonName}.`);
  },
};
