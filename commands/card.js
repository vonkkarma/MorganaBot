const { AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

// Register fonts
const fontsPath = path.join(__dirname, '..', 'assets', 'fonts');
try {
    registerFont(path.join(fontsPath, 'hgp-mincho-b.ttf'), { family: 'MS PMincho Regular' });
    registerFont(path.join(fontsPath, 'century-gothic-regular.ttf'), { family: 'Century Gothic Standard' });
    registerFont(path.join(fontsPath, 'NanumBrushScript-Regular.ttf'), { family: 'Nanum Brush Script Regular' });
    registerFont(path.join(fontsPath, 'nagurigaki-crayon.ttf'), { family: 'Nagurigaki Crayon Regular' });
} catch (error) {
    console.error('Error loading fonts:', error);
}

// Define styles
const Styles = [
    ["bakebrown.png", "Bakemonogatari type 1", [[0, 0, 80], "80px MS PMincho Regular", ["white", 3], "white", "center"]],
    ["bakered.png", "Bakemonogatari type 2", [[0, 0, 100], "80px MS PMincho Regular", ["white", 4], "white", "center"]],
    ["bakewhite.png", "Bakemonogatari type 3", [[0, 0, 80], "80px MS PMincho Regular", "", "#727085", "center"]],
    ["bakeblue.png", "Bakemonogatari type 4", [[0, 0, 100], "100px MS PMincho Regular", ["white", 2], "white", "center"]],
    ["bakewhite2.png", "Bakemonogatari type 5", [[0, 0, 100], "100px MS PMincho Regular", ["#685559", 4], "#685559", "center"]],
    ["bakebeige.png", "Bakemonogatari type 6", [[0, 0, 100], "100px MS PMincho Regular", ["white", 2], "white", "center"]],
    ["kizublack.png", "Kizumonogatari - black", [[0, 0, 180], "130px Century Gothic Standard", ["white", 8], "white", "center"]],
    ["kizured.png", "Kizumonogatari - red", [[0, 0, 180], "130px Century Gothic Standard", ["white", 8], "white", "center"]],
    ["tsukimono1.png", "Tsukimonogatari type 1", [[0, 0, 80], "80px MS PMincho Regular", ["#5BA5A6", 2], "#5BA5A6", "center"]],
    ["tsukimono2.png", "Tsukimonogatari - Koyomi theatre", [[0, 0, 120], "120px Nagurigaki Crayon Regular", ["black", 2], "#2a2a2a", "center"]],
    ["tsukimono3.png", "Tsukimonogatari - type 2", [[0, 0, 80], "80px Nanum Brush Script Regular", ["black", 2], "#5B667A", "center"]],
    ["tsukimono4.png", "Tsukimonogatari - type 3", [[0, 0, 80], "80px Nanum Brush Script Regular", ["yellow", 2], "#FAF2C1", "center"]],
    ["owari-koyomi.png", "Owarimonogatari - Koyomi", [[0, 0, 100], "100px Nanum Brush Script Regular", ["#202020", 2], "#E0E0E0", "center"]],
    ["owari-yotsugi.png", "Owarimonogatari - Yotsugi", [[0, 0, 100], "100px Nanum Brush Script Regular", ["#203020", 2], "#1A3E1C", "center"]],
];

// Utility functions
const insertChar = (str, item) => {
    return str.split('').join(item);
};

function splitTextIntoLines(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

module.exports = {
    name: 'card',
    description: 'Generate a Monogatari series titlecard',
    async execute(message, args) {
        try {
            let styleIndex = Math.floor(Math.random() * Styles.length);
            let monospace = false;

            // Check for style parameter
            const styleArgIndex = args.findIndex(arg => arg === '-s' || arg === '--style');
            if (styleArgIndex !== -1 && styleArgIndex < args.length - 1) {
                const styleArg = parseInt(args[styleArgIndex + 1]);
                if (!isNaN(styleArg)) {
                    if (styleArg > 0 && styleArg <= Styles.length) {
                        styleIndex = styleArg - 1;
                        args.splice(styleArgIndex, 2);
                    } else {
                        return message.reply(`Invalid style number. Please choose a number between 1 and ${Styles.length}.`);
                    }
                } else {
                    return message.reply(`Invalid style value. Use a number like \`-s 3\`.`);
                }

            }
            // Handle --list or -l to show available styles
            if (args.includes('--list') || args.includes('-l')) {
                const styleList = Styles.map((s, i) => `\`${i + 1}.\` ${s[1]}`).join('\n');
                return message.reply(`**Available Styles:**\n${styleList}`);
            }           

            // Check for double space
            const dsArgIndex = args.findIndex(arg => arg === '-m' || arg === '--monospace');
            if (dsArgIndex !== -1) {
                monospace = true;
                args.splice(dsArgIndex, 1);
            }


        

            // Join remaining args into input text
            let inputText = args.join(' ');
            if (!inputText) {
                return message.reply('Please provide text for the titlecard.');
            }
            

            if (monospace) {
                inputText = insertChar(inputText, ' ');
            }

            // Load style and image
            const styleInfo = Styles[styleIndex];
            const imagePath = path.join(__dirname, '..', 'assets', 'backgrounds', styleInfo[0]);
            const image = await loadImage(imagePath);

            const canvas = createCanvas(image.width, image.height);
            const ctx = canvas.getContext('2d');

            ctx.drawImage(image, 0, 0);

            const style = styleInfo[2];
            const textX = image.width / 2 + style[0][0];
            const textY = image.height / 2 + style[0][1];
            const lineSpacing = style[0][2];

            ctx.textBaseline = "middle";
            ctx.textAlign = style[4] || "center";
            ctx.font = style[1];
            if (style[2] !== "") {
                ctx.shadowColor = style[2][0];
                ctx.shadowBlur = style[2][1];
            }

            ctx.fillStyle = style[3];

            const lines = splitTextIntoLines(ctx, inputText, image.width * 0.9);

            if (lines.length === 1) {
                ctx.fillText(lines[0], textX, textY);
            } else {
                const startY = textY - ((lineSpacing * lines.length) / 2);
                lines.forEach((line, i) => {
                    ctx.fillText(line, textX, startY + (i * lineSpacing));
                });
            }
            const buffer = canvas.toBuffer();
            const attachment = new AttachmentBuilder(buffer, { name: 'titlecard.png' });

            await message.reply({
                content: `**Style:** ${styleInfo[1]}`,
                files: [attachment]
            });

        } catch (error) {
            console.error('Error generating titlecard:', error);
            await message.reply('Error generating the titlecard. Please try again.');
        }
    }
};
