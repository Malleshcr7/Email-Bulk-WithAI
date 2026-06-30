CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_name VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  template LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tasks_created (created_at)
);

CREATE TABLE IF NOT EXISTS recipients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  name VARCHAR(255) DEFAULT '',
  email VARCHAR(255) NOT NULL,
  company VARCHAR(255) DEFAULT '',
  extra JSON,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_recipients_task (task_id)
);

CREATE TABLE IF NOT EXISTS send_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  total_recipients INT NOT NULL DEFAULT 0,
  errors JSON,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_send_results_task (task_id)
);

CREATE TABLE IF NOT EXISTS niche_searches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  niche VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL,
  result_limit INT NOT NULL DEFAULT 50,
  status VARCHAR(50) NOT NULL,
  message TEXT,
  winning_provider VARCHAR(100),
  stats JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_niche_searches_created (created_at)
);

CREATE TABLE IF NOT EXISTS niche_leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  search_id INT NOT NULL,
  name VARCHAR(255) DEFAULT '',
  email VARCHAR(255) DEFAULT '',
  company VARCHAR(255) DEFAULT '',
  website VARCHAR(512) DEFAULT '',
  niche VARCHAR(255) DEFAULT '',
  source VARCHAR(255) DEFAULT '',
  FOREIGN KEY (search_id) REFERENCES niche_searches(id) ON DELETE CASCADE,
  INDEX idx_niche_leads_search (search_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('niche_search', 'task_created', 'email_sent') NOT NULL,
  ref_id INT NOT NULL,
  summary VARCHAR(512) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_type (type),
  INDEX idx_activity_created (created_at)
);

CREATE TABLE IF NOT EXISTS trial_usage (
  id TINYINT PRIMARY KEY,
  plan VARCHAR(50) NOT NULL DEFAULT 'trial',
  started_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  searches_used INT NOT NULL DEFAULT 0,
  export_rows_used INT NOT NULL DEFAULT 0,
  emails_sent INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
