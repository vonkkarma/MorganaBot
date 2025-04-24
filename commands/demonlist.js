const dataManager = require('../utils/DataManager');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'demonlist',
  description: 'List all demons',
  async execute(message, args) {
    const demons = await dataManager.getDemons();
    const demonEntries = Object.entries(demons);

    // Sorting demons by level, highest to lowest
    const sortedDemons = demonEntries.sort((a, b) => (b[1]?.level ?? 0) - (a[1]?.level ?? 0));

    const itemsPerPage = 5;
    let currentPage = 0;
    const maxPages = Math.ceil(sortedDemons.length / itemsPerPage);

    const generateEmbed = (page) => {
      const start = page * itemsPerPage;
      const end = Math.min(start + itemsPerPage, sortedDemons.length);
      const pageDemons = sortedDemons.slice(start, end);
      let content = '**Demon List:**\n\n';
      pageDemons.forEach(([demonName, demonData], index) => {
        content += `${start + index + 1}. ${demonName} (Lv ${demonData?.level})\n`;
      });
      content += `\nPágina ${page + 1}/${maxPages}`;
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

      const collector = reply.createMessageComponentCollector({
        filter,
        time: 60000
      });

      collector.on('collect', async (interaction) => {
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
        reply.edit({ components: [] });
      });
    } catch (error) {
      await reply.edit({ components: [] });
    }
  },
};
