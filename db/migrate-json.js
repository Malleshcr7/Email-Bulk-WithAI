require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initSchema, initPool, query } = require('./index');
const { createTask } = require('../modules/db/tasks');
const { saveSendResult } = require('../modules/db/sends');

const TASKS_DIR = path.join(__dirname, '..', 'tasks');

async function migrate() {
  await initSchema();
  await initPool();

  if (!fs.existsSync(TASKS_DIR)) {
    console.log('No tasks directory found');
    return;
  }

  const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('_results.json'));
  let imported = 0;

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, file), 'utf8'));
    const existing = await query('SELECT id FROM tasks WHERE task_name = ?', [data.taskName]);
    if (existing.length) {
      console.log(`Skip ${file} — already exists`);
      continue;
    }

    const task = await createTask({
      taskName: data.taskName,
      subject: data.subject,
      template: data.template,
      recipients: data.recipients
    });

    const resultsPath = path.join(TASKS_DIR, file.replace('.json', '_results.json'));
    if (fs.existsSync(resultsPath)) {
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      await saveSendResult(task.id, results);
    }

    console.log(`Imported ${file} → task #${task.id}`);
    imported++;
  }

  console.log(`Migration complete: ${imported} task(s) imported`);
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
