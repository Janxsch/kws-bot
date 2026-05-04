const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

function loadKnowledge() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    return '';
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort();

  if (files.length === 0) {
    return '';
  }

  const sections = files.map(file => {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf-8').trim();
    const name = file.replace('.md', '').replace(/-/g, ' ');
    return `### ${name}\n${content}`;
  });

  return sections.join('\n\n');
}

module.exports = { loadKnowledge };
