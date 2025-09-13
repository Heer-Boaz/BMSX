#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TAB_WIDTH = 4;

// For most source files we convert leading spaces to tabs (tabWidth = 4).
// Some filetypes must use spaces instead of tabs (e.g. YAML). We keep two
// sets: INCLUDED_EXTS (what file extensions we process) and
// SPACE_ONLY_EXTS (those extensions where tabs should be replaced with
// spaces, not converted to tabs).
const INCLUDED_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'jsm', 'json', 'md', 'css', 'html', 'ps1', 'sh', 'glsl', 'yaml', 'yml']);
const SPACE_ONLY_EXTS = new Set(['yaml', 'yml']);

function walk(dir, list = []) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const e of entries) {
		if (e.name === 'node_modules' || e.name === '.git') continue;
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full, list);
		else if (e.isFile()) {
			const ext = path.extname(full).toLowerCase().replace(/^\./, '');
			if (INCLUDED_EXTS.has(ext)) list.push(full);
		}
	}
	return list;
}

function convertFile(src, tabWidth = TAB_WIDTH) {
	// We'll scan the file char-by-char to track whether we're currently inside a
	// template literal and whether we're inside a ${} expression inside it.
	let inTemplate = false;
	let braceDepth = 0; // depth inside ${ }
	let i = 0;
	const len = src.length;
	const lines = [];
	let lineStart = 0;

	while (i < len) {
		const ch = src[i];
		if (ch === '`') {
			// Check for escaped backtick
			let esc = false;
			let j = i - 1;
			while (j >= 0 && src[j] === '\\') { esc = !esc; j--; }
			if (!esc) {
				if (!inTemplate) { inTemplate = true; braceDepth = 0; }
				else if (inTemplate && braceDepth === 0) { inTemplate = false; }
			}
			i++;
			continue;
		}

		if (inTemplate) {
			// detect ${ to enter expression mode
			if (src[i] === '$' && src[i + 1] === '{') {
				braceDepth = 1; i += 2; continue;
			}
			if (braceDepth > 0) {
				if (src[i] === '{') braceDepth++;
				else if (src[i] === '}') braceDepth--;
			}
			// advance
			i++;
			continue;
		}

		// Outside template literal: advance until newline
		if (ch === '\n') {
			const line = src.slice(lineStart, i);
			lines.push({ text: line, inTemplateContent: false });
			i++; lineStart = i; continue;
		}
		i++;
	}
	// last line
	if (lineStart <= len) {
		const line = src.slice(lineStart, len);
		// Determine whether this line is inside template content: we need to re-scan
		// up to this line to know template status at its start. Simpler approach: do
		// a second pass per-line to determine template state at line start.
		lines.push({ text: line, inTemplateContent: false });
	}

	// Now determine per-line whether its start is within template literal content
	let pos = 0;
	inTemplate = false; braceDepth = 0;
	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx].text;
		// The state at 'pos' applies to this line's start
		lines[idx].inTemplateContent = (inTemplate && braceDepth === 0);

		// Scan this line to update template/string state for next line
		for (let j = 0; j < line.length; j++) {
			const c = line[j];
			if (c === '`') {
				// escaped?
				let esc = false;
				let k = j - 1;
				while (k >= 0 && line[k] === '\\') { esc = !esc; k--; }
				if (!esc) {
					if (!inTemplate) { inTemplate = true; braceDepth = 0; }
					else if (inTemplate && braceDepth === 0) { inTemplate = false; }
				}
				continue;
			}
			if (inTemplate) {
				if (line[j] === '$' && line[j + 1] === '{') { braceDepth = 1; j++; continue; }
				if (braceDepth > 0) {
					if (line[j] === '{') braceDepth++;
					else if (line[j] === '}') braceDepth--;
				}
			}
		}

		pos += line.length + 1; // account for removed/newline
	}

	// Finally convert leading indentation for lines not in template content
	const outLines = lines.map(({ text, inTemplateContent }) => {
		if (inTemplateContent) return text; // don't touch lines which are inside template literal content
		// convert leading spaces/tabs to tabs
		let i = 0; let spaces = 0;
		while (i < text.length) {
			const ch = text[i];
			if (ch === ' ') { spaces++; i++; }
			else if (ch === '\t') { spaces += tabWidth; i++; }
			else break;
		}
		if (spaces === 0 && i === 0) return text;
		const tabs = Math.floor(spaces / tabWidth);
		const rem = spaces % tabWidth;
		const newIndent = '\t'.repeat(tabs) + ' '.repeat(rem);
		return newIndent + text.slice(i);
	});

	return outLines.join('\n');
}

function main() {
	const checkOnly = process.argv.indexOf('--check') !== -1 || process.argv.indexOf('-c') !== -1;
	const files = walk(ROOT);
	const changed = [];
		for (const f of files) {
			try {
				const src = fs.readFileSync(f, 'utf8');
				const ext = path.extname(f).toLowerCase().replace(/^\./, '');
				let out;
						if (SPACE_ONLY_EXTS.has(ext)) {
							// Replace all tab characters with TAB_WIDTH spaces for space-only files.
							out = src.replace(/\t/g, ' '.repeat(TAB_WIDTH));
						} else {
					out = convertFile(src, TAB_WIDTH);
				}
				if (out !== src) {
					changed.push(path.relative(ROOT, f));
					if (!checkOnly) fs.writeFileSync(f, out, 'utf8');
				}
			} catch (err) {
				console.error('Error processing', f, err && err.message);
			}
		}

	if (changed.length) {
		if (checkOnly) {
			console.error('Indentation issues found in the following files (leading spaces should be tabs):');
			changed.forEach(x => console.error('  ' + x));
			process.exitCode = 1; // non-zero to fail CI
		} else {
			console.log('Modified files:');
			changed.forEach(x => console.log('  ' + x));
		}
	} else {
		console.log('No changes needed');
	}
}

if (require.main === module) main();
