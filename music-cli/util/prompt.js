// util/prompt.js
const inquirer = require("inquirer");

/**
 * Executes a set of Inquirer prompts.
 * @param {Array<Object>} questions - Array of Inquirer question objects.
 * @returns {Promise<Object>} - Promise resolving to the answers object.
 */
async function ask(questions) {
    return await inquirer.prompt(questions);
}

module.exports = ask;