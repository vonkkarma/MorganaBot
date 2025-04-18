module.exports = {
    name: 'hee',
    description: 'Replies with ho!',
    async execute(message, args) {
      await message.reply('Te digo Ho!');
    },
  };
  