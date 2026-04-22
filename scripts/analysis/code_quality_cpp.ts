import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadAnalysisConfig, type AnalysisConfig } from './config';
import { collectSourceFiles, resolveInputPath } from './file_scan';
import { analyzeCppFiles } from './cpp_quality/analyzer';
import { type CppDuplicateGroup } from './cpp_quality/diagnostics';
import { printQualityLedger, qualityLedgerEntries, type QualityLedger } from './quality_ledger';
import { quoteCsv } from './csv';
import { commandExists } from './process';

type LintIssueSeverity = 'error' | 'warning' | 'information' | 'performance' | 'portability' | 'style' | string;
type LintTool = 'custom-cpp' | 'clang-tidy' | 'cppcheck';
type LintIssue = {
	file: string;
	line: number;
	column: number;
	severity: LintIssueSeverity;
	check: string;
	message: string;
	tool: LintTool;
};

type CliOptions = {
	csv: boolean;
	summaryOnly: boolean;
	failOnIssues: boolean;
	roots: string[];
	compileCommands: string | null;
	configFile: string | null;
};

const FILE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);
const CLANG_TIDY_RE = /^(.*?):(\d+):(\d+):\s*(warning|error):\s*(.*?)\s*\[([^\]]+)\]\s*$/;
const CPPCHECK_RE = /^(.*?):(\d+):(\d+):(warning|error|information|performance|portability|style):([^:]+):\s*(.*)$/;

function printHelp(config: AnalysisConfig): void {
	console.log('Usage: npx tsx scripts/analysis/code_quality_cpp.ts [--csv] [--summary-only] [--fail-on-issues] [--compile-commands <path>] [--config <path>] [--root <path> ...]');
	console.log('');
	console.log('Options:');
	console.log('  --csv                     Output CSV report');
	console.log('  --summary-only            Print only high-level summary rows');
	console.log('  --fail-on-issues          Exit with code 1 when any issue is found');
	console.log('  --compile-commands <path>  Path to compile_commands.json (clang-tidy)');
	console.log('  --config <path>           Path to .clang-tidy config file (clang-tidy)');
	console.log(`  --root <path>             Extra root directory to scan (default: ${config.scan.cppRoots.join(', ')})`);
	console.log('  --help                    Show this help message');
}

function parseStandaloneArgs(argv: string[], config: AnalysisConfig): CliOptions {
	let csv = false;
	let summaryOnly = false;
	let failOnIssues = false;
	const roots: string[] = [];
	let compileCommands: string | null = null;
	let configFile: string | null = null;

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
		if (arg === '--summary-only') {
			summaryOnly = true;
			continue;
		}
		if (arg === '--fail-on-issues') {
			failOnIssues = true;
			continue;
		}
		if (arg === '--compile-commands') {
			const value = readRequiredOptionValue(argv, index, '--compile-commands');
			compileCommands = value;
			index += 1;
			continue;
		}
		if (arg === '--config') {
			const value = readRequiredOptionValue(argv, index, '--config');
			configFile = value;
			index += 1;
			continue;
		}
		if (arg === '--root') {
			const value = readRequiredOptionValue(argv, index, '--root');
			roots.push(value);
			index += 1;
			continue;
		}
		if (arg.startsWith('--')) {
			throw new Error(`Unknown flag: ${arg}`);
		}
		roots.push(arg);
	}

	if (roots.length === 0) {
		return {
			csv,
			summaryOnly,
			failOnIssues,
			roots: [...config.scan.cppRoots],
			compileCommands,
			configFile,
		};
	}

	return {
		csv,
		summaryOnly,
		failOnIssues,
		roots,
		compileCommands,
		configFile,
	};
}

function readRequiredOptionValue(argv: readonly string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (value === undefined || value.startsWith('-')) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
}

function runProcess(command: string, args: string[]): { exitCode: number; output: string } {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
	if (result.error) {
		throw result.error;
	}
	let output = '';
	if (result.stdout) {
		output += result.stdout;
	}
	if (result.stderr) {
		output += result.stderr;
	}
	return {
		exitCode: result.status ?? 0,
		output,
	};
}

function normalizeFilePath(file: string): string {
	if (isAbsolute(file)) {
		return relative(process.cwd(), file);
	}
	return file;
}

function addIssue(
	issues: LintIssue[],
	tool: LintTool,
	file: string,
	line: number,
	column: number,
	severity: LintIssueSeverity,
	check: string,
	message: string,
): void {
	issues.push({
		tool,
		file: normalizeFilePath(file),
		line,
		column,
		severity,
		check,
		message: message.trim(),
	});
}

function parseClangTidyOutput(output: string, issues: LintIssue[]): void {
	const lines = output.split('\n');
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (line.length === 0) {
			continue;
		}
		const match = CLANG_TIDY_RE.exec(line);
		if (match === null) {
			continue;
		}
		addIssue(
			issues,
			'clang-tidy',
			match[1],
			Number.parseInt(match[2], 10),
			Number.parseInt(match[3], 10),
			match[4],
			match[6],
			match[5],
		);
	}
}

function parseCppCheckOutput(output: string, issues: LintIssue[]): void {
	const lines = output.split('\n');
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (line.length === 0) {
			continue;
		}
		const match = CPPCHECK_RE.exec(line);
		if (match === null) {
			continue;
		}
		addIssue(
			issues,
			'cppcheck',
			match[1],
			Number.parseInt(match[2], 10),
			Number.parseInt(match[3], 10),
			match[4],
			match[5],
			match[6].trim(),
		);
	}
}

function addCustomRuleIssues(issues: LintIssue[], analysisIssues: ReturnType<typeof analyzeCppFiles>['lintIssues']): void {
	for (let index = 0; index < analysisIssues.length; index += 1) {
		const issue = analysisIssues[index];
		issues.push({
			file: issue.file,
			line: issue.line,
			column: issue.column,
			severity: 'style',
			check: issue.kind,
			message: issue.message,
			tool: 'custom-cpp',
		});
	}
}

function splitIntoChunks<T>(items: readonly T[], chunkSize: number): T[][] {
	if (items.length === 0) {
		return [];
	}
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		chunks.push(items.slice(i, i + chunkSize));
	}
	return chunks;
}

function resolveCompileCommands(explicit: string | null): string | null {
	if (explicit !== null) {
		const candidate = resolveInputPath(explicit);
		if (existsSync(candidate)) {
			return candidate;
		}
		throw new Error(`Could not find compile_commands.json at "${candidate}"`);
	}
	return null;
}

function runClangTidy(
	files: readonly string[],
	_roots: readonly string[],
	compileCommands: string | null,
	configFile: string | null,
	headerFilter: string,
): LintIssue[] {
	if (!commandExists('clang-tidy')) {
		throw new Error('clang-tidy is not installed');
	}
	const issues: LintIssue[] = [];
	const chunks = splitIntoChunks(files, 80);
	for (let i = 0; i < chunks.length; i += 1) {
		const chunk = chunks[i];
		const args = [
			'--quiet',
			`--header-filter=${headerFilter}`,
		];
		if (compileCommands !== null && existsSync(compileCommands)) {
			args.push('-p', compileCommands);
		}
		if (configFile !== null && existsSync(configFile)) {
			args.push(`--config-file=${configFile}`);
		}
		for (let j = 0; j < chunk.length; j += 1) {
			args.push(chunk[j]);
		}
		const { output } = runProcess('clang-tidy', args);
		parseClangTidyOutput(output, issues);
	}
	return issues;
}

function runCppCheck(files: readonly string[], roots: readonly string[]): LintIssue[] {
	if (!commandExists('cppcheck')) {
		throw new Error('cppcheck is not installed');
	}
	const issues: LintIssue[] = [];
	const chunks = splitIntoChunks(files, 40);
	const includeRoots = new Set<string>();
	for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
		includeRoots.add(resolveInputPath(roots[rootIndex]));
	}
	for (let i = 0; i < chunks.length; i += 1) {
		const chunk = chunks[i];
		const args = [
			'--quiet',
			'--enable=warning,style,performance,portability,information',
			'--template={file}:{line}:{column}:{severity}:{id}:{message}',
			'--std=c++20',
			'--suppress=missingIncludeSystem',
			'--error-exitcode=1',
		];
		for (const includePath of includeRoots) {
			args.push('-I', includePath);
		}
		for (let fileIndex = 0; fileIndex < chunk.length; fileIndex += 1) {
			const file = chunk[fileIndex];
			args.push(file);
		}
		const { output } = runProcess('cppcheck', args);
		parseCppCheckOutput(output, issues);
	}
	return issues;
}

function toRelativeFile(file: string): string {
	return normalizeFilePath(file).replace(/\\/g, '/');
}

function getSummaryFolder(file: string): string {
	const normalized = toRelativeFile(file);
	const parts = normalized.split('/').filter(part => part.length > 0);
	if (parts.length <= 1) {
		return 'root';
	}
	return parts.slice(0, parts.length - 1).join('/');
}

function formatDuplicateLocation(location: CppDuplicateGroup['locations'][number]): string {
	if (location.context) {
		return `${location.file}:${location.line}:${location.column} (${location.context})`;
	}
	return `${location.file}:${location.line}:${location.column}`;
}

function printTokenDuplicateSummary(groups: readonly CppDuplicateGroup[]): void {
	if (groups.length === 0) {
		return;
	}
	const totalDuplicateDeclarations = groups.reduce((sum, group) => sum + group.count, 0);
	const byKind = new Map<string, number>();
	for (let index = 0; index < groups.length; index += 1) {
		const group = groups[index];
		byKind.set(group.kind, (byKind.get(group.kind) ?? 0) + group.count);
	}
	console.log('High-level C++ duplicate summary:');
	console.log(`  Total duplicate declaration group(s): ${groups.length}`);
	console.log(`  Total duplicated declarations: ${totalDuplicateDeclarations}`);
	console.log('  By kind:');
	for (const [kind, count] of Array.from(byKind.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
		console.log(`    ${kind}: ${count}`);
	}
	console.log('');
}

function printTextSummary(issues: readonly LintIssue[], duplicateGroups: readonly CppDuplicateGroup[], scannedFiles: number, summaryOnly: boolean, ledger: QualityLedger): void {
	if (issues.length === 0 && duplicateGroups.length === 0) {
		console.log('No C++ duplicates or lint issues found.');
		console.log(`Scanned ${scannedFiles} C++ files.`);
		printQualityLedger(ledger);
		return;
	}
	console.log(`Scanned ${scannedFiles} C++ files.\n`);

	if (!summaryOnly && duplicateGroups.length > 0) {
		console.log(`Found ${duplicateGroups.length} duplicated C++ declaration group(s).\n`);
		for (let index = 0; index < duplicateGroups.length; index += 1) {
			const group = duplicateGroups[index];
			console.log(`[${group.kind}] ${group.name} (${group.count}x)`);
			for (let locationIndex = 0; locationIndex < group.locations.length; locationIndex += 1) {
				console.log(`  ${formatDuplicateLocation(group.locations[locationIndex])}`);
			}
			console.log('');
		}
	}
	if (issues.length === 0) {
		printTokenDuplicateSummary(duplicateGroups);
		printQualityLedger(ledger);
		return;
	}
	const byCheck = new Map<string, number>();
	const byTool = new Map<string, number>();
	const bySeverity = new Map<string, number>();

	for (let i = 0; i < issues.length; i += 1) {
		const issue = issues[i];
		byCheck.set(issue.check, (byCheck.get(issue.check) ?? 0) + 1);
		byTool.set(issue.tool, (byTool.get(issue.tool) ?? 0) + 1);
		bySeverity.set(issue.severity, (bySeverity.get(issue.severity) ?? 0) + 1);
	}

	console.log('High-level C++ lint summary:');
	console.log(`  Total C++ lint issue(s): ${issues.length}`);
	console.log(`  Scanned files: ${scannedFiles}`);
	console.log('  By tool:');
	for (const [tool, count] of Array.from(byTool.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
		console.log(`    ${tool}: ${count}`);
	}
	console.log('  By severity:');
	const sortedSeverities = Array.from(bySeverity.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
	for (let i = 0; i < sortedSeverities.length; i += 1) {
		const severity = sortedSeverities[i];
		console.log(`    ${severity[0]}: ${severity[1]}`);
	}
	console.log('  By check:');
	const sortedChecks = Array.from(byCheck.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
	for (let i = 0; i < sortedChecks.length; i += 1) {
		const check = sortedChecks[i];
		console.log(`    ${check[0]}: ${check[1]}`);
	}
	console.log('  By folder (top):');
	const byFolder = new Map<string, number>();
	for (let i = 0; i < issues.length; i += 1) {
		const folder = getSummaryFolder(issues[i].file);
		byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
	}
	const sortedFolders = Array.from(byFolder.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
	for (let i = 0; i < sortedFolders.length; i += 1) {
		const folder = sortedFolders[i];
		console.log(`    ${folder[0]}: ${folder[1]}`);
	}
	console.log('');
	printTokenDuplicateSummary(duplicateGroups);
	printQualityLedger(ledger);
	if (summaryOnly) {
		return;
	}

	const byToolIssues = new Map<string, LintIssue[]>();
	for (let i = 0; i < issues.length; i += 1) {
		const issue = issues[i];
		let list = byToolIssues.get(issue.tool);
		if (list === undefined) {
			list = [];
			byToolIssues.set(issue.tool, list);
		}
		list.push(issue);
	}

	for (const tool of ['custom-cpp', 'clang-tidy', 'cppcheck']) {
		const list = byToolIssues.get(tool);
		if (list === undefined || list.length === 0) {
			continue;
		}
		console.log(`[${tool}]`);
		const byToolCheck = new Map<string, LintIssue[]>();
		for (let i = 0; i < list.length; i += 1) {
			const issue = list[i];
			let items = byToolCheck.get(issue.check);
			if (items === undefined) {
				items = [];
				byToolCheck.set(issue.check, items);
			}
			items.push(issue);
		}
		const sortedToolChecks = Array.from(byToolCheck.entries()).sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
		for (let i = 0; i < sortedToolChecks.length; i += 1) {
			const check = sortedToolChecks[i][0];
			const group = sortedToolChecks[i][1];
			const sortedGroup = group.sort((a, b) => {
				if (a.file !== b.file) {
					return a.file.localeCompare(b.file);
				}
				if (a.line !== b.line) {
					return a.line - b.line;
				}
				if (a.column !== b.column) {
					return a.column - b.column;
				}
				return a.severity.localeCompare(b.severity);
			});
			console.log(`  [${check}]`);
			for (let j = 0; j < sortedGroup.length; j += 1) {
				const issue = sortedGroup[j];
				console.log(`    ${issue.file}:${issue.line}:${issue.column}: ${issue.message} (${issue.severity})`);
			}
		}
	}
}

function printCsvRow(fields: readonly (string | number | undefined)[]): void {
	console.log(fields.map(quoteCsv).join(','));
}

function printIssueCsvQualityLedgerRows(ledger: QualityLedger): void {
	const entries = qualityLedgerEntries(ledger);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		printCsvRow(['summary', `ledger:${entry.name}`, '', '', entry.count, '', `Quality exception ledger "${entry.name}" count`]);
	}
}

function printIssueCsvReport(issues: readonly LintIssue[], duplicateGroups: readonly CppDuplicateGroup[], scannedFiles: number, summaryOnly: boolean, ledger: QualityLedger): void {
	console.log('file,line,column,tool,check,severity,message');
	if (!summaryOnly) {
		for (let groupIndex = 0; groupIndex < duplicateGroups.length; groupIndex += 1) {
			const group = duplicateGroups[groupIndex];
			for (let locationIndex = 0; locationIndex < group.locations.length; locationIndex += 1) {
				const location = group.locations[locationIndex];
				console.log([
					quoteCsv(location.file),
					quoteCsv(location.line),
					quoteCsv(location.column),
					quoteCsv('custom-cpp'),
					quoteCsv(`duplicate:${group.kind}`),
					quoteCsv('style'),
					quoteCsv(`Duplicate ${group.kind} declaration "${group.name}" appears ${group.count} times${location.context ? ` (${location.context})` : ''}.`),
				].join(','));
			}
		}
		for (let i = 0; i < issues.length; i += 1) {
			const issue = issues[i];
			console.log([
				quoteCsv(issue.file),
				quoteCsv(issue.line),
				quoteCsv(issue.column),
				quoteCsv(issue.tool),
				quoteCsv(issue.check),
				quoteCsv(issue.severity),
				quoteCsv(issue.message),
			].join(','));
		}
	}
	printCsvRow(['summary', 'scanned_files', '', '', scannedFiles, '', '']);
	printCsvRow(['summary', 'total_issues', issues.length, '', '', issues.length, '']);
	printCsvRow(['summary', 'total_duplicate_groups', duplicateGroups.length, '', '', duplicateGroups.length, '']);
	const byCheck = new Map<string, number>();
	for (let i = 0; i < issues.length; i += 1) {
		const issue = issues[i];
		byCheck.set(issue.check, (byCheck.get(issue.check) ?? 0) + 1);
	}
	for (const [check, count] of Array.from(byCheck.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
		printCsvRow(['summary', 'by_check', check, '', count, '', '']);
	}
	printIssueCsvQualityLedgerRows(ledger);
}

function runStandaloneReport(): void {
	const config = loadAnalysisConfig();
	const options = parseStandaloneArgs(process.argv.slice(2), config);
	const files = collectSourceFiles(options.roots, FILE_EXTENSIONS);
	if (files.length === 0) {
		console.log('No C++ files found.');
		return;
	}
	const issues: LintIssue[] = [];
	const customAnalysis = analyzeCppFiles(files);
	addCustomRuleIssues(issues, customAnalysis.lintIssues);
	const compileCommands = resolveCompileCommands(options.compileCommands);
	if (commandExists('clang-tidy')) {
		issues.push(...runClangTidy(files, options.roots, compileCommands, options.configFile, config.scan.cppHeaderFilter));
	} else if (commandExists('cppcheck')) {
		issues.push(...runCppCheck(files, options.roots));
	}
	const sortedIssues = issues.sort((left, right) => {
		if (left.tool !== right.tool) {
			return left.tool.localeCompare(right.tool);
		}
		if (left.file !== right.file) {
			return left.file.localeCompare(right.file);
		}
		if (left.line !== right.line) {
			return left.line - right.line;
		}
		if (left.column !== right.column) {
			return left.column - right.column;
		}
		return left.check.localeCompare(right.check);
	});

	if (options.csv) {
		printIssueCsvReport(sortedIssues, customAnalysis.duplicateGroups, files.length, options.summaryOnly, customAnalysis.ledger);
	} else {
		printTextSummary(sortedIssues, customAnalysis.duplicateGroups, files.length, options.summaryOnly, customAnalysis.ledger);
	}
	if (options.failOnIssues && (sortedIssues.length > 0 || customAnalysis.duplicateGroups.length > 0)) {
		process.exit(1);
	}
}

runStandaloneReport();
