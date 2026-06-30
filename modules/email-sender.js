const nodemailer = require('nodemailer');

function replaceTemplateVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return result;
}

function checkEmailEnv() {
  const required = ['EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM', 'EMAIL_FROM_NAME'];
  const missing = required.filter(v => !process.env[v]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

async function sendTaskEmails(taskData, { onProgress } = {}) {
  checkEmailEnv();
  const { taskName, subject, template, recipients } = taskData;
  if (!subject || !template || !recipients?.length) {
    throw new Error('Invalid task data format');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT === '465',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
  });

  const results = {
    taskName: taskName || 'Unnamed task',
    totalRecipients: recipients.length,
    successCount: 0,
    failureCount: 0,
    errors: [],
    startTime: new Date().toISOString(),
    endTime: null
  };

  for (const recipient of recipients) {
    if (!recipient.email) {
      results.errors.push('Recipient missing email field');
      results.failureCount++;
      continue;
    }
    try {
      await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
        to: recipient.email,
        subject: replaceTemplateVariables(subject, recipient),
        html: replaceTemplateVariables(template, recipient)
      });
      results.successCount++;
      if (onProgress) onProgress({ email: recipient.email, ok: true });
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      results.errors.push(`${recipient.email}: ${err.message}`);
      results.failureCount++;
      if (onProgress) onProgress({ email: recipient.email, ok: false, error: err.message });
    }
  }

  results.endTime = new Date().toISOString();
  return results;
}

module.exports = { sendTaskEmails, replaceTemplateVariables, checkEmailEnv };
