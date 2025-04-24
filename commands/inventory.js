const dataManager = require('../utils/DataManager');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'inventory',
  description: 'View your caught demons!',
  async execute(message, args) {
    const userId = message.author.id;
    const userDemons = await dataManager.getUserDemons(userId);
    const demons = await dataManager.getDemons();

    if (!userDemons.length) {
      return message.reply('You don\'t have any caught demons yet.');
    }

    // Sort demons by level, highest to lowest
    const sortedDemons = [...userDemons].sort((a, b) => {
      const levelA = demons[a]?.level ?? 0;
      const levelB = demons[b]?.level ?? 0;
      return levelB - levelA;
    });

    const itemsPerPage = 5;
    let currentPage = 0;
    const maxPages = Math.ceil(sortedDemons.length / itemsPerPage);

    const generateEmbed = (page) => {
      const start = page * itemsPerPage;
      const end = Math.min(start + itemsPerPage, sortedDemons.length);
      const pageDemons = sortedDemons.slice(start, end);
      
      let content = '**Your Demons:**\n\n';
      pageDemons.forEach((demonName, index) => {
        const demon = demons[demonName];
        content += `${start + index + 1}. ${demonName} (Lv ${demon?.level})\n`;
      });
      
      content += `\nPage ${page + 1}/${maxPages}`;
      return content;
    };

    const generateButtons = (page) => {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('⬅️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages - 1)
        );
      return [row];
    };

    const reply = await message.channel.send({
      content: generateEmbed(currentPage),
      components: generateButtons(currentPage)
    });

    try {
      const filter = i => {
        if (i.user.id !== userId) {
          i.reply({ content: "This isn't your inventory!", ephemeral: true });
          return false;
        }
        return true;
      };

      // Create a collector for button interactions
      const collector = reply.createMessageComponentCollector({ 
        filter,
        time: 60000 // 1 minute timeout
      });

      collector.on('collect', async (interaction) => {
        // Acknowledge the interaction first
        await interaction.deferUpdate();

        if (interaction.customId === 'prev_page') {
          currentPage = Math.max(0, currentPage - 1);
        } else if (interaction.customId === 'next_page') {
          currentPage = Math.min(maxPages - 1, currentPage + 1);
        }

        await reply.edit({
          content: generateEmbed(currentPage),
          components: generateButtons(currentPage)
        });
      });

      collector.on('end', () => {
        reply.edit({ components: [] }); // Remove buttons when collector expires
      });

    } catch (error) {
      await reply.edit({ components: [] });
    }
  },
};
