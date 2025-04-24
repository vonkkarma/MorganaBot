const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();
const token = process.env.DISCORD_TOKEN;
const path = require('path');
const dataManager = require('./utils/DataManager');

// Create a new client instance with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
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
    // Pass only necessary data to commands
    const demons = await dataManager.getDemons();
    await command.execute(message, args, demons);
  } catch (error) {
    console.error(error);
    await message.reply('There was an error while executing this command!');
  }
});

client.login(token);

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // Initialize data on startup
  try {
    await dataManager.getDemons();
    await dataManager.getMoves();
    await dataManager.getStatusEffects();
    await dataManager.getUserData();
    console.log('Data initialization complete!');
  } catch (error) {
    console.error('Error initializing data:', error);
  }
});
