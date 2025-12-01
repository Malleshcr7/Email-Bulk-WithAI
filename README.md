# 📧 Bulk Email Sender

A zero-cost, open-source, serverless system for sending personalized bulk emails using either **GitHub Actions** or your **local machine**. It uses SMTP to deliver emails and supports templated content, recipient list management via CSV, and detailed delivery reporting.

## 📋 Features

- Send personalized emails with template variables
- Import recipient lists via CSV
- Use GitHub Actions to run tasks serverlessly
- Or run everything locally using Node.js
- HTML email support
- Detailed success/failure reporting

## 🚀 Usage Options

You can use this system in two ways:

## ☁️ Option 1: GitHub Actions (Serverless)

No server required. Everything runs on GitHub's infrastructure.

### Step 1: Fork the Repository

Click the "Fork" button in the top right of this repo and fork it to your GitHub account.

### Step 2: Enable GitHub Pages

You can also skip this setup and directly use my page: [bulk-email-sender.yliu.tech](https://bulk-email-sender.yliu.tech) if you don't need to host your own instance.

1. Go to `Settings > Pages`
2. Choose "Deploy from a branch"
3. Select the `main` branch and the `/docs` folder
4. Click "Save"

Your UI will be live at `https://your-username.github.io/repo-name`

### Step 3: Configure GitHub Secrets

Go to `Settings > Secrets and variables > Actions` and add:

- `EMAIL_USER`: your SMTP username or email address
- `EMAIL_PASSWORD`: SMTP password or app password
- `EMAIL_HOST`: SMTP server (e.g. smtp.gmail.com)
- `EMAIL_PORT`: Port number (e.g. 587)
- `EMAIL_FROM`: Sender email address
- `EMAIL_FROM_NAME`: Sender display name

### Step 4: Create and Upload Task

1. Go to your GitHub Pages frontend or [bulk-email-sender.yliu.tech](https://bulk-email-sender.yliu.tech)
2. Fill out the email form and upload a CSV with [right format](#-csv-file-format)
3. Click "Generate Task JSON"
4. Download the `.json` file
5. Upload the file to the `/tasks` directory of your GitHub repo
6. Commit the change

✅ GitHub Actions will automatically send the emails and write a `*_results.json` file in the `/tasks` directory with logs.

## 💻 Option 2: Local Testing with Node.js

### Step 1: Clone the Repository

```bash
git clone https://github.com/jumpjumptiger007/bulk-email-sender.git
cd email-sender
```


### Step 2: Install Node.js and Dependencies

Check if Node.js is installed:

```bash
node -v
```

If not, download from https://nodejs.org

```bash
npm install
```

### Step 3: Create Environment File

You can copy the included `.env.template` to `.env` and fill in your SMTP credentials:

```bash
cp .env.template .env
```

⚠️ Edit the `.env` file and **replace the placeholder values**

### Step 4: Create a Task JSON File

Alternatively, you can use my online interface to generate this file: [bulk-email-sender.yliu.tech](https://bulk-email-sender.yliu.tech)

Format:

```json
{
  "taskName": "spring_campaign",
  "subject": "Hello {{first_name}}",
  "template": "<p>Dear {{first_name}}, welcome!</p>",
  "recipients": [
    { "email": "alice@example.com", "first_name": "Alice" }
  ]
}
```

### Step 5: Run the Script

```bash
node send-emails.js tasks/your_task_file.json
```

✅ A `*_results.json` file will be created after execution.

## 📊 CSV File Format

The system requires a CSV file with recipient information. Check [CSV Template](/recipients_template.csv) for the format.

Requirements:
- The first row must contain column headers
- One column must be named "email"
- All other columns can be used as variables in your email template
- Column names are used as variable names in the template (e.g., `{{name}}`)

## 📧 Email Template Format

You can use HTML in your email template for rich formatting. Variables are specified using double curly braces:

```html
<div style="font-family: Arial, sans-serif;">
  <h2>Hello, {{name}}!</h2>
  <p>We're reaching out from {{company}} to discuss your {{custom1}} subscription.</p>
</div>
```

## 💡 Tips

- Keep your email templates simple and responsive
- Test your template with a small recipient list first
- Use inline CSS for styling (many email clients don't support external stylesheets)
- Include an unsubscribe link to comply with email regulations
- Spread large campaigns across multiple tasks to avoid hitting rate limits

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/jumpjumptiger007/bulk-email-sender/issues).

## 🙏 Acknowledgements

- [PapaParse](https://www.papaparse.com/) for CSV parsing
- [Nodemailer](https://nodemailer.com/) for email sending functionality
- GitHub for providing free hosting and automation capabilities

## ⚠️ Disclaimer

This project is provided for educational and personal use only. You are responsible for complying with all applicable laws and email regulations (e.g., CAN-SPAM, GDPR). Misuse may lead to legal consequences or account restrictions. Use responsibly.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
