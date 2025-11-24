#!/usr/bin/env node
/* Move root-level `export function <name>` blocks between files using ts-morph.

   Usage:
     node scripts/move_functions.js \
       --source src/file.ts \
       --dest   src/other.ts \
       -n foo -n bar \
       [--names-file names.txt] \
       [--dry-run]

   Only root-level exported function declarations are moved:
     export function foo() {}
     export async function bar<T extends { a: number }>(x: T): { b: string } { ... }

   Overload sets are moved as a single contiguous block.
*/

const { Project } = require('ts-morph');
const fs = require('fs');
const path = require('path');
let sourcePath = null;
let destPath = null;

function parseArgs(argv) {
	const args = {
		source: null,
		dest: null,
		names: [],
		namesFile: null,
		dryRun: false
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--source') {
			args.source = argv[++i];
		} else if (a === '--dest') {
			args.dest = argv[++i];
		} else if (a === '--name' || a === '-n') {
			args.names.push(argv[++i]);
		} else if (a === '--names-file') {
			args.namesFile = argv[++i];
		} else if (a === '--dry-run') {
			args.dryRun = true;
		} else {
			console.error('Unknown argument:', a);
			process.exit(2);
		}
	}

	if (!args.source || !args.dest) {
		console.error(
			'Usage: move_functions.js ' +
			'--source src.ts --dest dest.ts -n foo [-n bar] [--names-file list.txt] [--dry-run]'
		);
		process.exit(2);
	}

	// Merge names from file if provided
	if (args.namesFile) {
		const txt = fs.readFileSync(args.namesFile, 'utf8');
		for (const raw of txt.split(/\r?\n/)) {
			const line = raw.trim();
			if (!line || line.startsWith('#')) continue;
			args.names.push(line);
		}
	}

	// Deduplicate names
	args.names = Array.from(new Set(args.names.map(n => n.trim()).filter(Boolean)));
	if (args.names.length === 0) {
		console.error('No function names provided.');
		process.exit(1);
	}

	return args;
}

/**
 * Locate the span [start,end) in the file text containing all root-level
 * `export function <name>` declarations (overloads + implementation).
 */
function locateExportedFunctionSpan(sf, name) {
	const allFns = sf.getFunctions();
	const candidates = allFns.filter(fn =>
		fn.getName() === name &&
		fn.isExported() &&
		fn.getParent() === sf // root-level only
	);

	if (candidates.length === 0) {
		console.warn(`No exported root-level function '${name}' found in '${sourcePath}'.`);
		// throw new Error(`exported root-level function '${name}' not found`);
	}

	// Overloads + implementation: grab the whole contiguous block
	const start = Math.min(...candidates.map(fn => fn.getFullStart()));
	const end = Math.max(...candidates.map(fn => fn.getFullStart() + fn.getFullWidth()));
	return { start, end };
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	sourcePath = path.resolve(args.source);
	destPath = path.resolve(args.dest);

	if (!fs.existsSync(sourcePath)) {
		console.error('Source file not found:', sourcePath);
		process.exit(1);
	}

	const sourceText = fs.readFileSync(sourcePath, 'utf8');
	const destText = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : '';

	// Use ts-morph purely as a parser on in-memory files
	const project = new Project({
		useInMemoryFileSystem: true,
		skipAddingFilesFromTsConfig: true
	});

	const sourceFile = project.createSourceFile('source.ts', sourceText, { overwrite: true });
	const destFile = project.createSourceFile('dest.ts', destText, { overwrite: true });

	// Check for duplicates in destination: any root-level exported function with same name
	const destExportedNames = new Set(
		destFile
			.getFunctions()
			.filter(fn => fn.isExported() && fn.getParent() === destFile && fn.getName())
			.map(fn => fn.getName())
	);
	const duplicates = args.names.filter(n => destExportedNames.has(n));
	if (duplicates.length) {
		console.error(
			`Destination file ${destPath} already contains exported functions: ${duplicates.join(', ')}`
		);
		console.error('Remove them or choose a different destination before running this tool.');
		process.exit(1);
	}

	// Compute spans once against the original source text
	const spans = [];
	const snippets = [];

	for (const name of args.names) {
		const { start, end } = locateExportedFunctionSpan(sourceFile, name);
		spans.push({ start, end, name });
		const raw = sourceText.slice(start, end);
		snippets.push({ name, text: raw.replace(/\s+$/, '') }); // trim trailing whitespace
	}

	// Remove blocks from source text, working from the end so offsets stay valid
	spans.sort((a, b) => b.start - a.start);
	let newSource = sourceText;
	for (const span of spans) {
		newSource = newSource.slice(0, span.start) + newSource.slice(span.end);
	}

	// Append snippets to destination text with clean spacing
	let newDest = destText.replace(/\s+$/, '');
	if (newDest.length > 0) newDest += '\n\n';
	newDest += snippets.map(s => s.text).join('\n\n') + '\n';

	console.log(
		`Extracted ${snippets.length} functions: ${snippets.map(s => s.name).join(', ')}`
	);

	if (args.dryRun) {
		console.log('Dry run enabled; no files were modified.');
		console.log('\n--- BEGIN DESTINATION PREVIEW ---\n');
		console.log(newDest);
		console.log('\n--- END DESTINATION PREVIEW ---');
		return;
	}

	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	fs.writeFileSync(sourcePath, newSource, 'utf8');
	fs.writeFileSync(destPath, newDest, 'utf8');
}

if (require.main === module) main();
