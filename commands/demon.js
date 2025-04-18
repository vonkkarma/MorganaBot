const moves = require('../moves.json'); // adjust the path as needed

module.exports = {
  name: 'demon',
  description: 'Get details about a demon',
  async execute(message, args, demons) {
    if (!args.length) {
      return message.reply('Please specify a demon name.');
    }

    const demonName = args.join(' ').toLowerCase();
    const demonKey = Object.keys(demons).find(key => key.toLowerCase() === demonName);

    if (!demonKey) {
      return message.reply(`I couldn't find a demon named "${demonName}".`);
    }

    const demonInfo = demons[demonKey];

    const abilitiesText = demonInfo.abilities.map(name => {
      const move = moves[name];
      if (!move) return `• ${name} — (Unknown Move)`;
      return `• ${move.emoji} **${move.name}** — ${move.type}, Power: ${move.power}`;
    }).join('\n');

    const demonDetails = `
**${demonInfo.name}**
- Level: ${demonInfo.level}
- HP: ${demonInfo.hp}
- Strength: ${demonInfo.strength}
- Magic: ${demonInfo.magic}
- Vitality: ${demonInfo.vitality}
- Speed: ${demonInfo.speed}

**Abilities**
${abilitiesText}

**Resistances**
• Weak: ${demonInfo.resistances?.weak.join(', ') || 'None'}
• Resist: ${demonInfo.resistances?.resist.join(', ') || 'None'}
`;

    await message.reply(demonDetails);
  },
};
