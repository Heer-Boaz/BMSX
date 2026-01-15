#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const child = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TAB_WIDTH = 4;

// For most source files we convert leading spaces to tabs (tabWidth = 4).
// Some filetypes must use spaces instead of tabs (e.g. YAML). We keep two
// sets: INCLUDED_EXTS (what file extensions we process) and
// SPACE_ONLY_EXTS (those extensions where tabs should be replaced with
// spaces, not converted to tabs).
const INCLUDED_EXTS = new Set([
	'ts', 'tsx', 'js', 'jsx', 'jsm', 'mjs', 'cjs',
	'json', 'md', 'css', 'html', 'ps1', 'sh',
	'glsl', 'yaml', 'yml', 'toml', 'ini', 'cfg',
	'cpp', 'h', 'c', 'hpp', 'cmake', 'make',
	'lua', 'txt', 'rommanifest',
]);
const INCLUDED_BASENAMES = new Set([
	'Makefile',
	'CMakeLists.txt',
	'.editorconfig',
	'.gitignore',
	'.gitattributes',
	'.npmrc',
	'.nvmrc',
]);
const SPACE_ONLY_EXTS = new Set(['yaml', 'yml', 'md']);

function loadEditorConfig() {
	const configPath = path.join(ROOT, '.editorconfig');
	if (!fs.existsSync(configPath)) return { global: {}, sections: [] };
	const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
	const sections = [];
	let current = { pattern: '*', props: {} };
	let haveSection = false;
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || line.startsWith(';')) continue;
		if (line.startsWith('[') && line.endsWith(']')) {
			if (haveSection) sections.push(current);
			current = { pattern: line.slice(1, -1).trim(), props: {} };
			haveSection = true;
			continue;
		}
		const idx = line.indexOf('=');
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		current.props[key] = value;
	}
	if (haveSection) sections.push(current);
	const globalProps = haveSection ? {} : current.props;
	return { global: globalProps, sections };
}

function expandBracePattern(pattern) {
	const match = pattern.match(/\{([^}]+)\}/);
	if (!match) return [pattern];
	const choices = match[1].split(',').map(part => part.trim()).filter(Boolean);
	return choices.map(choice => pattern.replace(match[0], choice));
}

function matchEditorConfigPattern(filePath, pattern) {
	const normalized = filePath.replace(/\\/g, '/');
	for (const expanded of expandBracePattern(pattern)) {
		const escaped = expanded.replace(/[.+^$()|[\]\\]/g, '\\$&');
		const regexBody = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
		const regex = new RegExp(`^${regexBody}$`);
		if (regex.test(normalized)) return true;
	}
	return false;
}

function getIndentStyleForPath(filePath, editorConfig) {
	let style = editorConfig.global.indent_style || '';
	for (const section of editorConfig.sections) {
		if (matchEditorConfigPattern(filePath, section.pattern)) {
			if (section.props.indent_style) style = section.props.indent_style;
		}
	}
	return style || '';
}

function splitNullDelimited(buffer) {
	return buffer
		.toString('utf8')
		.split('\0')
		.filter(Boolean);
}

function listCandidateFiles() {
	const tracked = child.spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer' });
	if (tracked.status !== 0) {
		throw new Error(`git ls-files failed: ${tracked.stderr ? tracked.stderr.toString('utf8') : tracked.status}`);
	}
	const untracked = child.spawnSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'buffer' });
	if (untracked.status !== 0) {
		throw new Error(`git ls-files --others failed: ${untracked.stderr ? untracked.stderr.toString('utf8') : untracked.status}`);
	}
	const files = new Set([...splitNullDelimited(tracked.stdout), ...splitNullDelimited(untracked.stdout)]);
	return Array.from(files);
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
		const indentMatch = text.match(/^[ \t]+/);
		if (!indentMatch) return text;
		const indent = indentMatch[0];
		let columns = 0;
		for (const ch of indent) {
			if (ch === '\t') {
				const toNext = tabWidth - (columns % tabWidth);
				columns += toNext;
			} else {
				columns += 1;
			}
		}
		if (columns === 0) return text;
		const tabs = Math.max(1, Math.ceil(columns / tabWidth));
		const newIndent = '\t'.repeat(tabs);
		return newIndent + text.slice(indent.length);
	});

	return outLines.join('\n');
}

function main() {
	const checkOnly = process.argv.indexOf('--check') !== -1 || process.argv.indexOf('-c') !== -1;
	const editorConfig = loadEditorConfig();
	const files = listCandidateFiles()
		.filter(p => !p.startsWith('tools/retroarch-gles2/') && p !== 'tools/retroarch-gles2')
		.filter(p => {
			const base = path.basename(p);
			const ext = path.extname(p).toLowerCase().replace(/^\./, '');
			return INCLUDED_BASENAMES.has(base) || INCLUDED_EXTS.has(ext);
		})
		.map(p => path.join(ROOT, p));
	const changed = [];
	for (const f of files) {
		try {
			const rel = path.relative(ROOT, f).replace(/\\/g, '/');
			const indentStyle = getIndentStyleForPath(rel, editorConfig);
			const src = fs.readFileSync(f, 'utf8');
			const ext = path.extname(f).toLowerCase().replace(/^\./, '');
			let out;
			if (indentStyle === 'space' || SPACE_ONLY_EXTS.has(ext)) {
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
