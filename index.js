const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');
const { token } = require('./config.json');
const path = require('path'); 


// Load the demon data
let demons = JSON.parse(fs.readFileSync('demons.json'));

// Create a new client instance
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Map();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.name, command);
}

// Prefix for commands
const prefix = '&';

client.on('messageCreate', async message => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);
  if (!command) return;

  try {
    await command.execute(message, args, demons);
  } catch (error) {
    console.error(error);
    await message.reply('There was an error while executing this command!');
  }
});

client.login(token);

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});
