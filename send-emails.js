require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sendTaskEmails } = require('./modules/email-sender');
const { initPool } = require('./db');
const { getTaskById } = require('./modules/db/tasks');
const { saveSendResult } = require('./modules/db/sends');

const arg = process.argv[2];

if (!arg) {
  console.error('Usage: node send-emails.js <task-file.json | task-id>');
  process.exit(1);
}

async function loadTask(input) {
  if (/^\d+$/.test(input)) {
    await initPool();
    const task = await getTaskById(parseInt(input, 10));
    if (!task) throw new Error(`Task #${input} not found in database`);
    return { task, taskId: task.id, fromDb: true };
  }

  const filePath = path.resolve(input);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const task = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { task, taskId: null, fromDb: false, filePath };
}

async function main() {
  const { task, taskId, fromDb, filePath } = await loadTask(arg);
  console.log(`Sending task: ${task.taskName} (${task.recipients.length} recipients)`);

  const results = await sendTaskEmails(task, {
    onProgress: ({ email, ok }) => console.log(ok ? `Sent: ${email}` : `Failed: ${email}`)
  });

  if (fromDb && taskId) {
    await saveSendResult(taskId, results);
    console.log('Results saved to database');
  } else if (filePath) {
    const resultsPath = filePath.replace('.json', '_results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${resultsPath}`);
  }

  console.log(`Done. Success: ${results.successCount}, Failed: ${results.failureCount}`);
  process.exit(results.failureCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
