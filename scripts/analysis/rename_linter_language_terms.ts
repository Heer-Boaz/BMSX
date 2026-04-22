import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';
import { collectSourceFiles } from './file_scan';

type Mode = 'dry-run' | 'write';

type Config = {
	readonly mode: Mode;
	readonly word: string;
	readonly roots: string[];
	readonly explicitRenames: ReadonlyMap<string, string>;
	readonly onlyOldTexts: ReadonlySet<string>;
	readonly aliasExternalImports: boolean;
};

type Occurrence = {
	readonly node: ts.Identifier;
	readonly oldText: string;
	readonly newText: string;
	readonly replacementText: string;
	readonly sourceNameOnly: boolean;
	readonly unsafePropertyName: boolean;
};

type BlockedRename = {
	readonly oldText: string;
	readonly newText: string;
	readonly reason: string;
};

type FilePlan = {
	readonly file: string;
	readonly source: string;
	readonly edits: TextEdit[];
	readonly blocked: BlockedRename[];
	readonly ignoredExternalNames: string[];
};

type TextEdit = {
	readonly start: number;
	readonly end: number;
	readonly text: string;
};

type RenameSummary = {
	readonly oldText: string;
	readonly newText: string;
	occurrences: number;
	files: Set<string>;
	externalAliases: number;
};

const IDENTIFIER_TEXT = /^[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*$/u;
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const USAGE = [
	'Usage: npx tsx scripts/analysis/rename_linter_language_terms.ts --word <Word> --root <path> [--root <path>] [--write]',
	'Options:',
	'  --word <Word>       CamelCase word to remove from local linter identifiers.',
	'  --root <path>       File or directory to scan. Repeatable.',
	'  --only A            Rename only this old identifier. Repeatable.',
	'  --rename A:B        Use B instead of the default A-without-word proposal. Repeatable.',
	'  --write             Apply safe edits. Dry-run is the default.',
	'  --no-external-alias  Do not rewrite external import specifiers to aliases.',
].join('\n');

function parseArgs(argv: readonly string[]): Config {
	let mode: Mode = 'dry-run';
	let word = '';
	let aliasExternalImports = true;
	const roots: string[] = [];
	const explicitRenames = new Map<string, string>();
	const onlyOldTexts = new Set<string>();

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--help' || arg === '-h') {
			console.log(USAGE);
			process.exit(0);
		}
		if (arg === '--write') {
			mode = 'write';
			continue;
		}
		if (arg === '--dry-run') {
			mode = 'dry-run';
			continue;
		}
		if (arg === '--no-external-alias') {
			aliasExternalImports = false;
			continue;
		}
		if (arg === '--word') {
			index += 1;
			word = argv[index];
			continue;
		}
		if (arg === '--root') {
			index += 1;
			roots.push(argv[index]);
			continue;
		}
		if (arg === '--only') {
			index += 1;
			onlyOldTexts.add(argv[index]);
			continue;
		}
		if (arg === '--rename') {
			index += 1;
			addExplicitRename(explicitRenames, argv[index]);
			continue;
		}
		throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
	}

	if (!word) {
		throw new Error(`Missing --word.\n${USAGE}`);
	}
	if (roots.length === 0) {
		throw new Error(`Missing --root.\n${USAGE}`);
	}
	if (!IDENTIFIER_TEXT.test(word)) {
		throw new Error(`Invalid word: ${word}`);
	}
	return {
		mode,
		word,
		roots,
		explicitRenames,
		onlyOldTexts,
		aliasExternalImports,
	};
}

function addExplicitRename(explicitRenames: Map<string, string>, value: string): void {
	const delimiter = value.indexOf(':');
	if (delimiter <= 0 || delimiter === value.length - 1) {
		throw new Error(`Invalid --rename value: ${value}`);
	}
	const oldText = value.slice(0, delimiter);
	const newText = value.slice(delimiter + 1);
	if (!IDENTIFIER_TEXT.test(oldText) || !IDENTIFIER_TEXT.test(newText)) {
		throw new Error(`Invalid --rename identifier pair: ${value}`);
	}
	explicitRenames.set(oldText, newText);
}

function normalizedPath(path: string): string {
	return resolve(path).replace(/\\/g, '/');
}

function collectRenameFiles(roots: readonly string[]): string[] {
	const files = collectSourceFiles(roots, new Set(['.ts', '.tsx', '.mts', '.cts']));
	return files.filter(file => !file.endsWith('.d.ts')).sort();
}

function proposedName(oldText: string, config: Config): string {
	const explicit = config.explicitRenames.get(oldText);
	if (explicit) {
		return explicit;
	}
	return oldText.split(config.word).join('');
}

function shouldConsiderIdentifier(text: string, config: Config): boolean {
	if (!text.includes(config.word)) {
		return false;
	}
	if (config.onlyOldTexts.size === 0) {
		return true;
	}
	return config.onlyOldTexts.has(text);
}

function resolveModuleFile(containingFile: string, moduleText: string): string | undefined {
	if (!moduleText.startsWith('.')) {
		return undefined;
	}
	const base = resolve(dirname(containingFile), moduleText);
	for (const extension of MODULE_EXTENSIONS) {
		const candidate = `${base}${extension}`;
		if (existsSync(candidate)) {
			return normalizedPath(candidate);
		}
	}
	for (const extension of MODULE_EXTENSIONS) {
		const candidate = resolve(base, `index${extension}`);
		if (existsSync(candidate)) {
			return normalizedPath(candidate);
		}
	}
	return undefined;
}

function moduleSpecifierText(node: ts.ImportDeclaration | ts.ExportDeclaration): string | undefined {
	const specifier = node.moduleSpecifier;
	if (!specifier || !ts.isStringLiteral(specifier)) {
		return undefined;
	}
	return specifier.text;
}

function moduleIsOutsideSelectedRoots(file: string, moduleText: string, selectedFiles: ReadonlySet<string>): boolean {
	const resolved = resolveModuleFile(file, moduleText);
	if (resolved === undefined) {
		return true;
	}
	return !selectedFiles.has(resolved);
}

function moduleTextIsOutsideSelectedRoots(file: string, moduleText: string | undefined, selectedFiles: ReadonlySet<string>): boolean {
	if (moduleText === undefined) {
		return false;
	}
	return moduleIsOutsideSelectedRoots(file, moduleText, selectedFiles);
}

function importDeclarationForSpecifier(node: ts.ImportSpecifier): ts.ImportDeclaration {
	return node.parent.parent.parent as ts.ImportDeclaration;
}

function exportDeclarationForSpecifier(node: ts.ExportSpecifier): ts.ExportDeclaration | undefined {
	const declaration = node.parent.parent;
	return ts.isExportDeclaration(declaration) ? declaration : undefined;
}

function isExternalSourceSpecifierName(propertyName: ts.ModuleExportName | undefined, node: ts.Identifier, file: string, moduleText: string | undefined, selectedFiles: ReadonlySet<string>): boolean {
	if (propertyName !== node) {
		return false;
	}
	return moduleTextIsOutsideSelectedRoots(file, moduleText, selectedFiles);
}

function shouldAliasExternalSpecifierName(name: ts.ModuleExportName, propertyName: ts.ModuleExportName | undefined, node: ts.Identifier, file: string, moduleText: string | undefined, selectedFiles: ReadonlySet<string>): boolean {
	if (name !== node || propertyName !== undefined) {
		return false;
	}
	return moduleTextIsOutsideSelectedRoots(file, moduleText, selectedFiles);
}

function isSourceNameOnlyInExternalSpecifier(file: string, node: ts.Identifier, selectedFiles: ReadonlySet<string>): boolean {
	const parent = node.parent;
	if (ts.isImportSpecifier(parent)) {
		const declaration = importDeclarationForSpecifier(parent);
		const moduleText = moduleSpecifierText(declaration);
		return isExternalSourceSpecifierName(parent.propertyName, node, file, moduleText, selectedFiles);
	}
	if (ts.isExportSpecifier(parent)) {
		const declaration = exportDeclarationForSpecifier(parent);
		const moduleText = declaration ? moduleSpecifierText(declaration) : undefined;
		return isExternalSourceSpecifierName(parent.propertyName, node, file, moduleText, selectedFiles);
	}
	return false;
}

function externalImportAliasReplacement(file: string, node: ts.Identifier, newText: string, selectedFiles: ReadonlySet<string>, aliasExternalImports: boolean): string | undefined {
	if (!aliasExternalImports) {
		return undefined;
	}
	const parent = node.parent;
	if (ts.isImportSpecifier(parent) && parent.name === node && !parent.propertyName) {
		const declaration = importDeclarationForSpecifier(parent);
		const moduleText = moduleSpecifierText(declaration);
		if (shouldAliasExternalSpecifierName(parent.name, parent.propertyName, node, file, moduleText, selectedFiles)) {
			return `${node.text} as ${newText}`;
		}
	}
	if (ts.isExportSpecifier(parent) && parent.name === node && !parent.propertyName) {
		const declaration = exportDeclarationForSpecifier(parent);
		const moduleText = declaration ? moduleSpecifierText(declaration) : undefined;
		if (shouldAliasExternalSpecifierName(parent.name, parent.propertyName, node, file, moduleText, selectedFiles)) {
			return `${node.text} as ${newText}`;
		}
	}
	return undefined;
}

function isUnsafePropertyName(node: ts.Identifier): boolean {
	const parent = node.parent;
	return (ts.isPropertyAccessExpression(parent) && parent.name === node)
		|| (ts.isPropertyAssignment(parent) && parent.name === node)
		|| (ts.isMethodDeclaration(parent) && parent.name === node)
		|| (ts.isPropertyDeclaration(parent) && parent.name === node)
		|| (ts.isPropertySignature(parent) && parent.name === node)
		|| (ts.isMethodSignature(parent) && parent.name === node);
}

function isOccupiedLocalName(node: ts.Identifier): boolean {
	const parent = node.parent;
	return !((ts.isPropertyAccessExpression(parent) && parent.name === node)
		|| (ts.isPropertyAssignment(parent) && parent.name === node)
		|| (ts.isMethodDeclaration(parent) && parent.name === node)
		|| (ts.isPropertyDeclaration(parent) && parent.name === node)
		|| (ts.isPropertySignature(parent) && parent.name === node)
		|| (ts.isMethodSignature(parent) && parent.name === node)
		|| (ts.isImportSpecifier(parent) && parent.propertyName === node)
		|| (ts.isExportSpecifier(parent) && parent.propertyName === node));
}

function collectIdentifiers(sourceFile: ts.SourceFile, file: string, selectedFiles: ReadonlySet<string>, config: Config): { occurrences: Occurrence[]; occupiedLocalNames: Set<string>; } {
	const occurrences: Occurrence[] = [];
	const occupiedLocalNames = new Set<string>();

	function visit(node: ts.Node): void {
		if (ts.isIdentifier(node)) {
			if (isOccupiedLocalName(node)) {
				occupiedLocalNames.add(node.text);
			}
			if (shouldConsiderIdentifier(node.text, config)) {
				const newText = proposedName(node.text, config);
				const aliasReplacement = externalImportAliasReplacement(file, node, newText, selectedFiles, config.aliasExternalImports);
				occurrences.push({
					node,
					oldText: node.text,
					newText,
					replacementText: aliasReplacement || newText,
					sourceNameOnly: isSourceNameOnlyInExternalSpecifier(file, node, selectedFiles),
					unsafePropertyName: isUnsafePropertyName(node),
				});
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return { occurrences, occupiedLocalNames };
}

function blockedOldTexts(occurrences: readonly Occurrence[], occupiedLocalNames: ReadonlySet<string>): Map<string, BlockedRename> {
	const blocked = new Map<string, BlockedRename>();
	const proposedByOld = new Map<string, string>();
	const oldByNew = new Map<string, string>();
	const renamedOldTexts = new Set<string>();

	for (const occurrence of occurrences) {
		if (!occurrence.sourceNameOnly) {
			renamedOldTexts.add(occurrence.oldText);
		}
	}
	for (const occurrence of occurrences) {
		if (occurrence.sourceNameOnly) {
			continue;
		}
		if (occurrence.newText.length === 0 || !IDENTIFIER_TEXT.test(occurrence.newText)) {
			blocked.set(occurrence.oldText, {
				oldText: occurrence.oldText,
				newText: occurrence.newText,
				reason: 'proposal is not a valid identifier',
			});
			continue;
		}
		if (occurrence.unsafePropertyName) {
			blocked.set(occurrence.oldText, {
				oldText: occurrence.oldText,
				newText: occurrence.newText,
				reason: 'identifier is an object or class property name',
			});
			continue;
		}
		const previousProposal = proposedByOld.get(occurrence.oldText);
		if (previousProposal !== undefined && previousProposal !== occurrence.newText) {
			blocked.set(occurrence.oldText, {
				oldText: occurrence.oldText,
				newText: occurrence.newText,
				reason: `conflicting proposals: ${previousProposal} and ${occurrence.newText}`,
			});
			continue;
		}
		proposedByOld.set(occurrence.oldText, occurrence.newText);
		const previousOld = oldByNew.get(occurrence.newText);
		if (previousOld !== undefined && previousOld !== occurrence.oldText) {
			blocked.set(occurrence.oldText, {
				oldText: occurrence.oldText,
				newText: occurrence.newText,
				reason: `same target as ${previousOld}`,
			});
			blocked.set(previousOld, {
				oldText: previousOld,
				newText: occurrence.newText,
				reason: `same target as ${occurrence.oldText}`,
			});
			continue;
		}
		oldByNew.set(occurrence.newText, occurrence.oldText);
		if (occupiedLocalNames.has(occurrence.newText) && !renamedOldTexts.has(occurrence.newText)) {
			blocked.set(occurrence.oldText, {
				oldText: occurrence.oldText,
				newText: occurrence.newText,
				reason: 'target already exists in file',
			});
		}
	}
	return blocked;
}

function buildFilePlan(file: string, selectedFiles: ReadonlySet<string>, config: Config): FilePlan {
	const source = readFileSync(file, 'utf8');
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const { occurrences, occupiedLocalNames } = collectIdentifiers(sourceFile, file, selectedFiles, config);
	const blocked = blockedOldTexts(occurrences, occupiedLocalNames);
	const edits: TextEdit[] = [];
	const ignoredExternalNames: string[] = [];

	for (const occurrence of occurrences) {
		if (occurrence.sourceNameOnly) {
			ignoredExternalNames.push(occurrence.oldText);
			continue;
		}
		if (blocked.has(occurrence.oldText)) {
			continue;
		}
		edits.push({
			start: occurrence.node.getStart(sourceFile),
			end: occurrence.node.getEnd(),
			text: occurrence.replacementText,
		});
	}

	return {
		file,
		source,
		edits,
		blocked: Array.from(blocked.values()),
		ignoredExternalNames: Array.from(new Set(ignoredExternalNames)).sort(),
	};
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
	let output = source;
	const sorted = edits.slice().sort((a, b) => b.start - a.start);
	for (const edit of sorted) {
		output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
	}
	return output;
}

function summarize(plans: readonly FilePlan[]): Map<string, RenameSummary> {
	const summaries = new Map<string, RenameSummary>();
	for (const plan of plans) {
		for (const edit of plan.edits) {
			const oldText = plan.source.slice(edit.start, edit.end);
			const aliasIndex = edit.text.indexOf(' as ');
			const newText = aliasIndex >= 0 ? edit.text.slice(aliasIndex + 4) : edit.text;
			const key = `${oldText}\0${newText}`;
			let summary = summaries.get(key);
			if (!summary) {
				summary = {
					oldText,
					newText,
					occurrences: 0,
					files: new Set(),
					externalAliases: 0,
				};
				summaries.set(key, summary);
			}
			summary.occurrences += 1;
			summary.files.add(plan.file);
			if (aliasIndex >= 0) {
				summary.externalAliases += 1;
			}
		}
	}
	return summaries;
}

function printSummary(files: readonly string[], plans: readonly FilePlan[], mode: Mode): void {
	const summaries = Array.from(summarize(plans).values()).sort((a, b) => b.occurrences - a.occurrences || a.oldText.localeCompare(b.oldText));
	const blocked = plans.flatMap(plan => plan.blocked.map(item => ({ file: plan.file, item })));
	const ignoredExternalNames = plans.flatMap(plan => plan.ignoredExternalNames.map(name => ({ file: plan.file, name })));
	const editCount = plans.reduce((count, plan) => count + plan.edits.length, 0);

	console.log(`${mode === 'write' ? 'Applied' : 'Dry-run'}: ${editCount} identifier edit(s) across ${files.length} file(s).`);
	if (summaries.length > 0) {
		console.log('\nSafe renames:');
		for (const summary of summaries.slice(0, 80)) {
			const aliasText = summary.externalAliases > 0 ? `, ${summary.externalAliases} import/export alias(es)` : '';
			console.log(`  ${summary.oldText} -> ${summary.newText}: ${summary.occurrences} occurrence(s), ${summary.files.size} file(s)${aliasText}`);
		}
		if (summaries.length > 80) {
			console.log(`  ... ${summaries.length - 80} more`);
		}
	}
	if (blocked.length > 0) {
		console.log('\nBlocked renames:');
		for (const entry of blocked.slice(0, 80)) {
			console.log(`  ${entry.item.oldText} -> ${entry.item.newText || '<empty>'}: ${entry.item.reason} (${entry.file})`);
		}
		if (blocked.length > 80) {
			console.log(`  ... ${blocked.length - 80} more`);
		}
	}
	if (ignoredExternalNames.length > 0) {
		console.log('\nKept external source names:');
		for (const entry of ignoredExternalNames.slice(0, 40)) {
			console.log(`  ${entry.name} (${entry.file})`);
		}
		if (ignoredExternalNames.length > 40) {
			console.log(`  ... ${ignoredExternalNames.length - 40} more`);
		}
	}
}

function runLanguageTermRename(): void {
	const config = parseArgs(process.argv.slice(2));
	const files = collectRenameFiles(config.roots);
	const selectedFiles = new Set(files.map(normalizedPath));
	const plans = files.map(file => buildFilePlan(normalizedPath(file), selectedFiles, config));
	const blockedCount = plans.reduce((count, plan) => count + plan.blocked.length, 0);

	if (config.mode === 'write' && blockedCount > 0) {
		printSummary(files, plans, 'dry-run');
		throw new Error(`Refusing to write with ${blockedCount} blocked rename(s). Add explicit --rename entries or narrow --root.`);
	}
	if (config.mode === 'write') {
		for (const plan of plans) {
			if (plan.edits.length === 0) {
				continue;
			}
			writeFileSync(plan.file, applyEdits(plan.source, plan.edits));
		}
	}
	printSummary(files, plans, config.mode);
}

try {
	runLanguageTermRename();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
