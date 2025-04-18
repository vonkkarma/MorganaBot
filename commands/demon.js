module.exports = {
  name: 'demon',
  description: 'Get details about a demon',
  async execute(message, args, demons) {
    if (!args.length) {
      return message.reply('Please specify a demon name.');
    }

    // Join args into a full string and sanitize it to lowercase
    const demonName = args.join(' ').toLowerCase();

    // Find the demon by matching the lowercase version of the name
    const demon = Object.keys(demons).find(key => key.toLowerCase() === demonName);

    if (!demon) {
      return message.reply(`I couldn't find a demon named "${demonName}".`);
    }

    // Retrieve the demon details
    const demonInfo = demons[demon];

    const demonDetails = `
**${demonInfo.name}**
- Level: ${demonInfo.level}
- HP: ${demonInfo.hp}
- Attack: ${demonInfo.attack}
- Defense: ${demonInfo.defense}
- Speed: ${demonInfo.speed}

**Abilities**
${demonInfo.abilities.map(a => `• ${a.name} — ${a.type}, Power: ${a.power}`).join('\n')}

**Resistances**
• Weak: ${demonInfo.resistances?.weak.join(', ') || 'None'}
• Resist: ${demonInfo.resistances?.resist.join(', ') || 'None'}
`;

    await message.reply(demonDetails);
  },
};
