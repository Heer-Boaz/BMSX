import { addDuplicateExportedTypeIssues, collectExportedTypes, type ExportedTypeInfo } from '../../lint/rules/code_quality/duplicate_exported_type_name_pattern';
import { addNormalizedBodyDuplicateIssues, type NormalizedBodyInfo } from '../../lint/rules/code_quality/normalized_ast_duplicate_pattern';
import { addSemanticNormalizedBodyDuplicateIssues } from '../../lint/rules/code_quality/semantic_normalized_body_duplicate_pattern';
import { addRepeatedStatementSequenceIssues, type StatementSequenceInfo } from '../../lint/rules/common/repeated_statement_sequence_pattern';
import { type TsLintIssue as LintIssue } from '../../lint/ts_rule';
import { type AnalysisConfig, loadAnalysisConfig } from '../config';
import { collectSourceFiles } from '../file_scan';
import { filterSuppressedLintIssues } from '../lint_suppressions';
import { createQualityLedger, type QualityLedger, qualityLedgerEntries } from '../quality_ledger';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';
import { collectFunctionUsageCounts } from '../../lint/rules/ts/support/function_usage';
import { ClassInfo, CliOptions, DuplicateGroup, DuplicateKind, DuplicateLocation, FolderLintSummary, ProjectLanguage } from '../../lint/rules/ts/support/types';
import { buildDuplicateGroups, walkDeclarations } from './declarations';
import { collectClassInfos, collectLintIssues, collectNormalizedBodies } from './source_scan';

export const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

export const LINT_SUMMARY_MAX_FOLDER_SEGMENTS = 5;

export const CPP_FILE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);

export function printHelp(config: AnalysisConfig): void {
	console.log('Usage: npx tsx scripts/analysis/code_quality.ts [--csv] [--summary-only] [--fail-on-issues] [--root <path> ...]');
	console.log('');
	console.log('Options:');
	console.log('  --csv                  Output CSV report');
	console.log('  --fail-on-issues       Exit with code 1 when issues are found');
	console.log('  --summary-only         Print only high-level summaries (no per-issue detail)');
	console.log(`  --root <path>          Extra root directory (default: ${config.scan.roots.join(', ')})`);
	console.log('  --help                 Show this help message');
	console.log('');
	console.log('When a C++ folder is detected, extra flags are passed directly to:');
	console.log('  scripts/analysis/code_quality_cpp.ts');
}

export function parseArgs(argv: string[], config: AnalysisConfig): CliOptions {
	let failOnIssues = false;
	let csv = false;
	let summaryOnly = false;
	const paths: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--help') {
			printHelp(config);
			process.exit(0);
		}
		if (arg === '--csv') {
			csv = true;
			continue;
		}
		if (arg === '--fail-on-issues') {
			failOnIssues = true;
			continue;
		}
		if (arg === '--summary-only') {
			summaryOnly = true;
			continue;
		}
		if (arg === '--root') {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('-')) {
				throw new Error(`Missing value for --root`);
			}
			paths.push(value);
			index += 1;
			continue;
		}
		if (arg.startsWith('-')) {
			throw new Error(`Unknown flag "${arg}". Use --help for usage.`);
		}
		paths.push(arg);
	}
	if (paths.length === 0) {
		return {
			csv,
			failOnIssues,
			summaryOnly,
			paths: [...config.scan.roots],
		};
	}
	return {
		csv,
		failOnIssues,
		summaryOnly,
		paths,
	};
}

export function extractRootsForLanguageDetection(argv: string[], config: AnalysisConfig): string[] {
	const paths: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--root') {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('-')) {
				throw new Error('Missing value for --root');
			}
			paths.push(value);
			index += 1;
			continue;
		}
		if (arg === '--compile-commands' || arg === '--config') {
			const next = argv[index + 1];
			if (next !== undefined && !next.startsWith('-')) {
				index += 1;
			}
			continue;
		}
		if (arg.startsWith('--')) {
			// Skip option/value pairs that are intended for the C++ linter. This keeps
			// mixed CLI behavior working without hard-coding all options here.
			continue;
		}
		paths.push(arg);
	}
	if (paths.length === 0) {
		return [...config.scan.roots];
	}
	return paths;
}

export function hasCommand(command: string): boolean {
	const result = spawnSync(command, ['--version'], {
		encoding: 'utf8',
		stdio: 'ignore',
		maxBuffer: 1024 * 1024,
	});
	return result.error === undefined;
}

export function runCppQuality(args: readonly string[]): number {
	if (!hasCommand('npx')) {
		throw new Error('npx is required to run C++ quality checks');
	}
	const result = spawnSync('npx', ['tsx', 'scripts/analysis/code_quality_cpp.ts', ...args], {
		encoding: 'utf8',
		maxBuffer: 24 * 1024 * 1024,
		stdio: 'inherit',
	});
	if (result.error) {
		throw result.error;
	}
	return result.status ?? 0;
}

export function detectProjectLanguage(roots: readonly string[]): ProjectLanguage {
	let hasTypeScript = false;
	let hasCpp = false;
	const files = collectSourceFiles(roots, new Set([...FILE_EXTENSIONS, ...CPP_FILE_EXTENSIONS]));
	for (let index = 0; index < files.length; index += 1) {
		const extension = extname(files[index]);
		if (FILE_EXTENSIONS.has(extension)) {
			hasTypeScript = true;
		}
		if (CPP_FILE_EXTENSIONS.has(extension)) {
			hasCpp = true;
		}
		if (hasTypeScript && hasCpp) {
			return 'mixed';
		}
	}
	if (hasTypeScript && !hasCpp) {
		return 'ts';
	}
	if (!hasTypeScript && hasCpp) {
		return 'cpp';
	}
	return 'unknown';
}

export function formatLocation(location: DuplicateLocation): string {
	const link = formatVscodeLocationLink(location.file, location.line, location.column);
	if (location.context) {
		return `${link} (${location.context})`;
	}
	return link;
}

export function formatLintIssue(issue: LintIssue): string {
	const link = formatVscodeLocationLink(issue.file, issue.line, issue.column);
	return `${link}: ${issue.message} (${issue.name})`;
}

export function formatVscodeLocationLink(file: string, line: number, column: number): string {
	const absolute = isAbsolute(file) ? file : resolve(process.cwd(), file);
	const normalized = absolute.replace(/\\/g, '/');
	const relativePath = toRelativePath(normalized);
	return `${relativePath}:${line}:${column}`;
}

export function getLintSummaryFolder(file: string): string {
	const normalized = toRelativePath(file).replace(/\\/g, '/');
	const pathForSummary = normalized.startsWith('..') ? file : normalized;
	const parts = pathForSummary.replace(/\\/g, '/').split('/').filter(part => part.length > 0);
	if (parts.length <= 1) {
		return 'root';
	}
	const folderParts = parts.slice(0, -1);
	const folderDepth = Math.min(folderParts.length, LINT_SUMMARY_MAX_FOLDER_SEGMENTS);
	return folderParts.slice(0, folderDepth).join('/');
}

export function formatPercent(numerator: number, denominator: number): string {
	if (denominator <= 0) {
		return '0.0%';
	}
	return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function printLintSummary(lintIssues: readonly LintIssue[]): void {
	if (lintIssues.length === 0) {
		console.log('No lint issues found.');
		console.log('');
		return;
	}

	const byRule = new Map<string, number>();
	const byFolder = new Map<string, FolderLintSummary>();
	for (let issueIndex = 0; issueIndex < lintIssues.length; issueIndex += 1) {
		const issue = lintIssues[issueIndex];
		const rule = issue.kind;
		byRule.set(rule, (byRule.get(rule) ?? 0) + 1);

		const folder = getLintSummaryFolder(issue.file);
		let folderSummary = byFolder.get(folder);
		if (folderSummary === undefined) {
			folderSummary = { folder, total: 0, byRule: new Map<string, number>() };
			byFolder.set(folder, folderSummary);
		}
		folderSummary.total += 1;
		folderSummary.byRule.set(rule, (folderSummary.byRule.get(rule) ?? 0) + 1);
	}

	const sortedRules = Array.from(byRule.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
	const sortedFolders = Array.from(byFolder.values()).sort((left, right) => right.total - left.total || left.folder.localeCompare(right.folder));

	console.log('High-level lint summary:');
	console.log(`  Total lint issue(s): ${lintIssues.length}`);
	console.log('  By rule:');
	for (let i = 0; i < sortedRules.length; i += 1) {
		const rule = sortedRules[i];
		const percent = formatPercent(rule[1], lintIssues.length);
		console.log(`    ${rule[0]}: ${rule[1]} (${percent})`);
	}
	console.log('  By folder (hotspot):');
	for (let i = 0; i < sortedFolders.length; i += 1) {
		const folderSummary = sortedFolders[i];
		const percent = formatPercent(folderSummary.total, lintIssues.length);
		console.log(`    ${folderSummary.folder}: ${folderSummary.total} (${percent})`);
		const folderRules = Array.from(folderSummary.byRule.entries())
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
		for (let j = 0; j < folderRules.length; j += 1) {
			const rule = folderRules[j];
			const rulePercent = formatPercent(rule[1], lintIssues.length);
			console.log(`      ${rule[0]}: ${rule[1]} (${rulePercent})`);
		}
	}
	console.log('');
}

export function printCsvLintSummaryRows(lintIssues: readonly LintIssue[]): void {
	const byRule = new Map<string, number>();
	const byFolder = new Map<string, FolderLintSummary>();
	for (let issueIndex = 0; issueIndex < lintIssues.length; issueIndex += 1) {
		const issue = lintIssues[issueIndex];
		const rule = issue.kind;
		byRule.set(rule, (byRule.get(rule) ?? 0) + 1);

		const folder = getLintSummaryFolder(issue.file);
		let folderSummary = byFolder.get(folder);
		if (folderSummary === undefined) {
			folderSummary = { folder, total: 0, byRule: new Map<string, number>() };
			byFolder.set(folder, folderSummary);
		}
		folderSummary.total += 1;
		folderSummary.byRule.set(rule, (folderSummary.byRule.get(rule) ?? 0) + 1);
	}

	console.log([
		quoteCsv('summary'),
		quoteCsv('lint_total'),
		quoteCsv(lintIssues.length),
		quoteCsv(formatPercent(lintIssues.length, lintIssues.length)),
		quoteCsv(''),
		quoteCsv(''),
		quoteCsv(''),
		quoteCsv(`Total lint issues (${formatPercent(lintIssues.length, lintIssues.length)})`),
	].join(','));
	for (const [rule, count] of Array.from(byRule.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
		const percent = formatPercent(count, lintIssues.length);
		console.log([
			quoteCsv('summary'),
			quoteCsv(`rule:${rule}`),
			quoteCsv(count),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(`Lint rule "${rule}" count (${percent})`),
		].join(','));
	}
	for (const folderSummary of Array.from(byFolder.values()).sort((left, right) => right.total - left.total || left.folder.localeCompare(right.folder))) {
		const folderPercent = formatPercent(folderSummary.total, lintIssues.length);
		console.log([
			quoteCsv('summary'),
			quoteCsv(`folder:${folderSummary.folder}`),
			quoteCsv(folderSummary.total),
			quoteCsv(folderSummary.folder),
			quoteCsv(folderPercent),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(`Lint issues in folder "${folderSummary.folder}" (${folderPercent})`),
		].join(','));
		for (const [rule, count] of Array.from(folderSummary.byRule.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
			const percent = formatPercent(count, lintIssues.length);
			console.log([
				quoteCsv('summary'),
				quoteCsv(`folder-rule:${folderSummary.folder}:${rule}`),
				quoteCsv(count),
				quoteCsv(folderSummary.folder),
				quoteCsv(percent),
				quoteCsv(''),
				quoteCsv(''),
				quoteCsv(`Rule "${rule}" in ${folderSummary.folder} (${percent})`),
			].join(','));
		}
	}
}

export function printCsvDuplicateSummaryRows(groups: readonly DuplicateGroup[]): void {
	if (groups.length === 0) {
		return;
	}
	const totalDuplicateDeclarations = groups.reduce((sum, group) => sum + group.count, 0);
	const byKind = new Map<DuplicateKind, number>();
	for (let i = 0; i < groups.length; i += 1) {
		const group = groups[i];
		byKind.set(group.kind, (byKind.get(group.kind) ?? 0) + group.count);
	}
	const totalPercent = formatPercent(totalDuplicateDeclarations, totalDuplicateDeclarations);
	console.log([
		quoteCsv('summary'),
		quoteCsv('duplicate_total_groups'),
		quoteCsv(groups.length),
		quoteCsv(''),
		quoteCsv(totalPercent),
		quoteCsv(''),
		quoteCsv(''),
		quoteCsv(`Duplicate declaration groups: ${groups.length} (${totalPercent})`),
	].join(','));
	console.log([
		quoteCsv('summary'),
		quoteCsv('duplicate_total_declarations'),
		quoteCsv(totalDuplicateDeclarations),
		quoteCsv(''),
		quoteCsv(totalPercent),
		quoteCsv(''),
		quoteCsv(''),
		quoteCsv(`Total duplicated declarations: ${totalDuplicateDeclarations} (${totalPercent})`),
	].join(','));
	for (const [kind, count] of Array.from(byKind.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
		const percent = formatPercent(count, totalDuplicateDeclarations);
		console.log([
			quoteCsv('summary'),
			quoteCsv(`duplicate_kind:${kind}`),
			quoteCsv(count),
			quoteCsv(''),
			quoteCsv(percent),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(`Duplicate declarations by kind "${kind}" (${percent})`),
		].join(','));
	}
}

export function printDuplicateSummary(groups: readonly DuplicateGroup[]): void {
	if (groups.length === 0) {
		return;
	}
	const totalDuplicateDeclarations = groups.reduce((sum, group) => sum + group.count, 0);
	const byKind = new Map<DuplicateKind, number>();
	for (let i = 0; i < groups.length; i += 1) {
		const group = groups[i];
		byKind.set(group.kind, (byKind.get(group.kind) ?? 0) + group.count);
	}
	const sortedKinds = Array.from(byKind.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
	console.log('High-level duplicate summary:');
	console.log(`  Total duplicate declaration groups: ${groups.length}`);
	console.log(`  Total duplicated declarations: ${totalDuplicateDeclarations}`);
	console.log('  By kind:');
	for (let i = 0; i < sortedKinds.length; i += 1) {
		const kind = sortedKinds[i];
		const percent = formatPercent(kind[1], totalDuplicateDeclarations);
		console.log(`    ${kind[0]}: ${kind[1]} (${percent})`);
	}
	console.log('');
}

export function printQualityLedger(ledger: QualityLedger): void {
	const entries = qualityLedgerEntries(ledger);
	if (entries.length === 0) {
		return;
	}
	console.log('Quality exception ledger:');
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		console.log(`  ${entry.name}: ${entry.count}`);
	}
	console.log('');
}

export function printCsvQualityLedgerRows(ledger: QualityLedger): void {
	const entries = qualityLedgerEntries(ledger);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		console.log([
			quoteCsv('summary'),
			quoteCsv(`ledger:${entry.name}`),
			quoteCsv(entry.count),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(`Quality exception ledger "${entry.name}" count`),
		].join(','));
	}
}

export function printTextReport(groups: DuplicateGroup[], lintIssues: LintIssue[], scannedFiles: number, summaryOnly: boolean, ledger: QualityLedger): void {
	if (groups.length === 0 && lintIssues.length === 0) {
		console.log('No duplicates or lint issues found.');
		console.log(`Scanned ${scannedFiles} TypeScript files.`);
		printQualityLedger(ledger);
		return;
	}
	console.log(`Scanned ${scannedFiles} TypeScript files.\n`);
	if (groups.length > 0) {
		console.log(`Found ${groups.length} duplicated declaration group(s).\n`);
		for (const group of groups) {
			console.log(`[${group.kind}] ${group.name} (${group.count}x)`);
			for (const location of group.locations) {
				console.log(`  ${formatLocation(location)}`);
			}
			if (group.kind === 'interface') {
				console.log('  interface declarations can legally merge; verify if intentional.');
			}
			console.log('');
		}
	}
	if (!summaryOnly && lintIssues.length > 0) {
		console.log(`Found ${lintIssues.length} lint issue(s).\n`);
		const issuesByKind = new Map<LintIssue['kind'], LintIssue[]>();
		for (const issue of lintIssues) {
			let list = issuesByKind.get(issue.kind);
			if (list === undefined) {
				list = [];
				issuesByKind.set(issue.kind, list);
			}
			list.push(issue);
		}
		for (const kind of Array.from(issuesByKind.keys()).sort()) {
			const issues = issuesByKind.get(kind);
			if (issues === undefined || issues.length === 0) {
				continue;
			}
			console.log(`[lint:${kind}]`);
			for (const issue of issues) {
				console.log(`  ${formatLintIssue(issue)}`);
			}
			console.log('');
		}
	}
	printDuplicateSummary(groups);
	printLintSummary(lintIssues);
	printQualityLedger(ledger);
}

export function quoteCsv(value: string | number | undefined): string {
	const text = `${value ?? ''}`;
	if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r') || text.includes('\t')) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

export function printCsvReport(groups: DuplicateGroup[], lintIssues: LintIssue[], scannedFiles: number, summaryOnly: boolean, ledger: QualityLedger): void {
	console.log('kind,name_or_rule,count,file,line,column,context,message');
	if (!summaryOnly) {
		for (const group of groups) {
			for (const location of group.locations) {
				console.log([
					quoteCsv(group.kind),
					quoteCsv(group.name),
					quoteCsv(group.count),
					quoteCsv(formatVscodeLocationLink(location.file, location.line, location.column)),
					quoteCsv(location.line),
					quoteCsv(location.column),
					quoteCsv(location.context ?? ''),
					quoteCsv(''),
				].join(','));
			}
		}
		for (const issue of lintIssues) {
			console.log([
				quoteCsv(`lint:${issue.kind}`),
				quoteCsv(issue.name),
				quoteCsv(1),
				quoteCsv(formatVscodeLocationLink(issue.file, issue.line, issue.column)),
				quoteCsv(issue.line),
				quoteCsv(issue.column),
				quoteCsv(''),
				quoteCsv(issue.message),
			].join(','));
		}
	}
	console.log([
		quoteCsv('summary'),
		quoteCsv('scanned_files'),
		quoteCsv(scannedFiles),
		quoteCsv(''),
		quoteCsv(''),
		quoteCsv(''),
		quoteCsv(''),
		quoteCsv(''),
	].join(','));
	printCsvDuplicateSummaryRows(groups);
	printCsvLintSummaryRows(lintIssues);
	printCsvQualityLedgerRows(ledger);
}

export function toRelativePath(path: string): string {
	return relative(process.cwd(), path);
}

export function run(): void {
	const config = loadAnalysisConfig();
	const argv = process.argv.slice(2);
	if (argv.includes('--help')) {
		parseArgs(argv, config);
		return;
	}
	const inferredRoots = extractRootsForLanguageDetection(argv, config);
	const language = detectProjectLanguage(inferredRoots);
	if (language === 'cpp') {
		const exitCode = runCppQuality(argv);
		if (exitCode !== 0) {
			process.exit(exitCode);
		}
		return;
	}
	const options = parseArgs(argv, config);
	if (language === 'mixed') {
		throw new Error('Mixed TypeScript and C++ sources detected. Run the analyzer on one language folder at a time.');
	}
	if (language === 'unknown') {
		console.log('No TypeScript or C++ files found in the provided roots.');
		return;
	}
	const fileList = collectSourceFiles(options.paths, FILE_EXTENSIONS);
	const buckets = new Map<string, DuplicateLocation[]>();
	const classInfosByKey = new Map<string, ClassInfo>();
	const classInfosByName = new Map<string, ClassInfo[]>();
	const classInfosByFileName = new Map<string, Map<string, ClassInfo[]>>();
	const lintIssues: LintIssue[] = [];
	const sourceFiles: ts.SourceFile[] = [];
	const sourceTextByFile = new Map<string, string>();
	const exportedTypes: ExportedTypeInfo[] = [];
	const normalizedBodies: NormalizedBodyInfo[] = [];
	const statementSequences: StatementSequenceInfo[] = [];
	const ledger = createQualityLedger();
	for (const filePath of fileList) {
		const sourceText = readFileSync(filePath, 'utf8');
		const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind);
		sourceFiles.push(sourceFile);
		sourceTextByFile.set(filePath, sourceText);
		collectClassInfos(sourceFile, classInfosByKey, classInfosByName, classInfosByFileName);
		collectExportedTypes(sourceFile, exportedTypes);
		collectNormalizedBodies(sourceFile, config, normalizedBodies, ledger);
	}
	const functionUsageInfo = collectFunctionUsageCounts(sourceFiles);
	for (const sourceFile of sourceFiles) {
		collectLintIssues(sourceFile, config, lintIssues, statementSequences, functionUsageInfo, ledger);
	}
	addDuplicateExportedTypeIssues(exportedTypes, lintIssues);
	addNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	addSemanticNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
	addRepeatedStatementSequenceIssues(statementSequences, lintIssues);
	for (const sourceFile of sourceFiles) {
		walkDeclarations(sourceFile, buckets, classInfosByKey, classInfosByName, classInfosByFileName);
	}
	const groups = buildDuplicateGroups(buckets).map(group => ({
		...group,
		locations: group.locations.map(location => ({
			...location,
			file: toRelativePath(location.file),
		})),
	}));
	const filteredLintIssues = filterSuppressedLintIssues(lintIssues, sourceTextByFile, config.directiveMarker);
	const normalizedLintIssues = filteredLintIssues.map(issue => ({
		...issue,
		file: toRelativePath(issue.file),
	}));
	if (options.csv) {
		printCsvReport(groups, normalizedLintIssues, fileList.length, options.summaryOnly, ledger);
	} else {
		const sortedIssues = [...normalizedLintIssues].sort((left, right) => {
			if (left.file !== right.file) {
				return left.file.localeCompare(right.file);
			}
			if (left.line !== right.line) {
				return left.line - right.line;
			}
			if (left.column !== right.column) {
				return left.column - right.column;
			}
			return left.kind.localeCompare(right.kind);
		});
		printTextReport(groups, sortedIssues, fileList.length, options.summaryOnly, ledger);
	}
	if (options.failOnIssues && (groups.length > 0 || normalizedLintIssues.length > 0)) {
		process.exit(1);
	}
}
