#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function parseGitignore() {
  const gitignorePath = path.join(root, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  const content = fs.readFileSync(gitignorePath, 'utf8');
  return content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
}

function isIgnored(file, ignorePatterns) {
  const rel = path.relative(root, file);
  for (const pattern of ignorePatterns) {
	const p = pattern.replace(/\/$/, '');
	if (rel === p || rel.startsWith(p + '/') || rel.startsWith(p)) return true;
  }
  return false;
}

function walk(dir, list=[], ignorePatterns=[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
	if (e.name === 'node_modules' || e.name === '.git') continue;
	const full = path.join(dir, e.name);
	if (isIgnored(full, ignorePatterns)) continue;
	if (e.isDirectory()) walk(full, list, ignorePatterns);
	else if (e.isFile() && (full.endsWith('.ts') || full.endsWith('.js') || full.endsWith('.cpp') || full.endsWith('.h') )) list.push(full);
  }
  return list;
}

function convertLeadingIndent(line, tabWidth=4) {
  let i = 0;
  let spaces = 0;
  while (i < line.length) {
	const ch = line[i];
	if (ch === ' ') { spaces++; i++; }
	else if (ch === '\t') { spaces += tabWidth; i++; }
	else break;
  }
  if (spaces === 0 && i === 0) return line; // no leading indent
  const tabs = Math.floor(spaces / tabWidth);
  const rem = spaces % tabWidth;
  const newIndent = '\t'.repeat(tabs) + ' '.repeat(rem);
  return newIndent + line.slice(i);
}

function fixFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const out = lines.map(l => convertLeadingIndent(l, 4)).join('\n');
  if (out !== src) {
	fs.writeFileSync(file, out, 'utf8');
	return true;
  }
  return false;
}

function main() {
  const ignorePatterns = parseGitignore();
  const files = walk(root, [], ignorePatterns);
  let changed = [];
  for (const f of files) {
	try {
	  if (fixFile(f)) changed.push(path.relative(root, f));
	} catch (err) {
	  console.error('Error processing', f, err.message);
	}
  }
  if (changed.length) {
	console.log('Modified files:');
	changed.forEach(x => console.log('  ' + x));
	process.exit(0);
  } else {
	console.log('No changes needed');
  }
}

if (require.main === module) main();
