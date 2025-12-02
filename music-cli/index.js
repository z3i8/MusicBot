// index.js (formerly the main part of your script)

// require("dotenv").config() is commented out but should be used if needed
// require("dotenv").config(); 
const chalk = require("chalk");
const ask = require("./util/prompt");

// Import commands
const { addBot, listBots, deleteBot, updateBot } = require("./commands/bot");
const { addChannels } = require("./commands/channel");

console.log(chalk.cyan("🔧 Multi-Bot Manager CLI\n"));

async function mainMenu() {
    try {
        const { action } = await ask([
            {
                type: "list",
                name: "action",
                message: "Choose an action:",
                choices: [
                    "➕ Add new bot",
                    "📜 List all bots",
                    "➕ Add channels to bot",
                    "🗑️ Delete bot",
                    "⚙️ Update bot settings",
                    "❌ Exit",
                ],
            },
        ]);

        let nextAction;

        switch (action) {
            case "➕ Add new bot":
                nextAction = addBot;
                break;
            case "📜 List all bots":
                nextAction = listBots;
                break;
            case "➕ Add channels to bot":
                nextAction = addChannels;
                break;
            case "🗑️ Delete bot":
                nextAction = deleteBot;
                break;
            case "⚙️ Update bot settings":
                nextAction = updateBot;
                break;
            case "❌ Exit":
                console.log(chalk.yellow("Exiting CLI. Goodbye!"));
                return process.exit(0);
        }

        // Execute the selected action
        await nextAction();

    } catch (error) {
        // Handle CTRL+C or other inquirer errors gracefully
        if (error.isTtyError) {
             console.log(chalk.red("❌ Prompts could not be rendered in the current environment."));
        } else {
             console.error(chalk.red("An error occurred:"), error.message);
        }
    } finally {
        // Loop back to the main menu unless exiting
        await mainMenu();
    }
}

// Start the application
mainMenu();