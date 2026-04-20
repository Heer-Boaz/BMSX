import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { analyzeCppFiles, type CppDuplicateGroup } from './code_quality_cpp_rules';

type LintIssueSeverity = 'error' | 'warning' | 'information' | 'performance' | 'portability' | 'style' | string;
type LintTool = 'bmsx-cpp' | 'clang-tidy' | 'cppcheck';
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

const DEFAULT_ROOTS = ['src/bmsx_cpp'];
const FILE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);
const SKIP_DIRECTORIES = new Set([
	'.git',
	'.vscode',
	'build',
	'build-codex-check',
	'build-debug',
	'build-libretro',
	'build-libretro-host',
	'build-libretro-local',
	'build-libretro-wsl',
	'build-perf',
	'build-release',
	'build-snesmini',
	'build-snesmini-host',
	'build-snesmini-user',
	'CMakeFiles',
	'dist',
	'node_modules',
	'vendor',
]);

const HEADER_FILTER = 'src/bmsx_cpp/.*';
const CLANG_TIDY_RE = /^(.*?):(\d+):(\d+):\s*(warning|error):\s*(.*?)\s*\[([^\]]+)\]\s*$/;
const CPPCHECK_RE = /^(.*?):(\d+):(\d+):(warning|error|information|performance|portability|style):([^:]+):\s*(.*)$/;

function printHelp(): void {
	console.log('Usage: npx tsx scripts/analysis/code_quality_cpp.ts [--csv] [--summary-only] [--fail-on-issues] [--compile-commands <path>] [--config <path>] [--root <path> ...]');
	console.log('');
	console.log('Options:');
	console.log('  --csv                     Output CSV report');
	console.log('  --summary-only            Print only high-level summary rows');
	console.log('  --fail-on-issues          Exit with code 1 when any issue is found');
	console.log('  --compile-commands <path>  Path to compile_commands.json (clang-tidy)');
	console.log('  --config <path>           Path to .clang-tidy config file (clang-tidy)');
	console.log('  --root <path>             Extra root directory to scan (default: src/bmsx_cpp)');
	console.log('  --help                    Show this help message');
}

function parseArgs(argv: string[]): CliOptions {
	let csv = false;
	let summaryOnly = false;
	let failOnIssues = false;
	const roots: string[] = [];
	let compileCommands: string | null = null;
	let configFile: string | null = null;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--help') {
			printHelp();
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
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('-')) {
				throw new Error('Missing value for --compile-commands');
			}
			compileCommands = value;
			index += 1;
			continue;
		}
		if (arg === '--config') {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('-')) {
				throw new Error('Missing value for --config');
			}
			configFile = value;
			index += 1;
			continue;
		}
		if (arg === '--root') {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('-')) {
				throw new Error('Missing value for --root');
			}
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
			roots: DEFAULT_ROOTS,
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

function shouldSkipDirectory(name: string): boolean {
	return SKIP_DIRECTORIES.has(name) || name.startsWith('.') && name.length > 1;
}

function resolveInputPath(candidate: string): string {
	return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function collectCppFiles(roots: readonly string[]): string[] {
	const files: string[] = [];
	const stack = roots.map(resolveInputPath);
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined || !existsSync(current)) {
			continue;
		}
		const stat = statSync(current);
		if (stat.isFile()) {
			const extension = extname(current);
			if (FILE_EXTENSIONS.has(extension)) {
				files.push(current);
			}
			continue;
		}
		if (!stat.isDirectory()) {
			continue;
		}
		const directoryName = basename(current);
		if (shouldSkipDirectory(directoryName)) {
			continue;
		}
		const entries = readdirSync(current, { withFileTypes: true });
		for (let i = 0; i < entries.length; i += 1) {
			const entry = entries[i];
			stack.push(join(current, entry.name));
		}
	}
	return files;
}

function hasCommand(command: string): boolean {
	const result = spawnSync(command, ['--version'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
	return result.error === undefined;
}

function runProcess(command: string, args: string[]): { exitCode: number; output: string } {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
	if (result.error) {
		throw result.error;
	}
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
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

function addBmsxRuleIssues(issues: LintIssue[], analysisIssues: ReturnType<typeof analyzeCppFiles>['lintIssues']): void {
	for (let index = 0; index < analysisIssues.length; index += 1) {
		const issue = analysisIssues[index];
		issues.push({
			file: issue.file,
			line: issue.line,
			column: issue.column,
			severity: 'style',
			check: issue.kind,
			message: issue.message,
			tool: 'bmsx-cpp',
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

function resolveCompileCommands(roots: readonly string[], explicit: string | null): string | null {
	if (explicit !== null) {
		const candidate = resolveInputPath(explicit);
		if (existsSync(candidate)) {
			return candidate;
		}
		throw new Error(`Could not find compile_commands.json at "${candidate}"`);
	}
	const candidates = [
		resolve(process.cwd(), 'compile_commands.json'),
		resolve(process.cwd(), 'build', 'compile_commands.json'),
		resolve(process.cwd(), 'build-debug', 'compile_commands.json'),
		resolve(process.cwd(), 'build-release', 'compile_commands.json'),
	];
	for (let i = 0; i < roots.length; i += 1) {
		const root = resolveInputPath(roots[i]);
		candidates.push(resolve(root, 'build', 'compile_commands.json'));
		candidates.push(resolve(root, 'build-debug', 'compile_commands.json'));
	}
	for (let i = 0; i < candidates.length; i += 1) {
		const candidate = candidates[i];
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function runClangTidy(
	files: readonly string[],
	_roots: readonly string[],
	compileCommands: string | null,
	configFile: string | null,
): LintIssue[] {
	if (!hasCommand('clang-tidy')) {
		throw new Error('clang-tidy is not installed');
	}
	const issues: LintIssue[] = [];
	const chunks = splitIntoChunks(files, 80);
	for (let i = 0; i < chunks.length; i += 1) {
		const chunk = chunks[i];
		const args = [
			'--quiet',
			`--header-filter=${HEADER_FILTER}`,
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
	if (!hasCommand('cppcheck')) {
		throw new Error('cppcheck is not installed');
	}
	const issues: LintIssue[] = [];
	const chunks = splitIntoChunks(files, 40);
	const includeRoots = new Set<string>();
	for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
		includeRoots.add(resolveInputPath(roots[rootIndex]));
	}
	includeRoots.add(resolve(process.cwd(), 'src/bmsx_cpp'));
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

function printDuplicateSummary(groups: readonly CppDuplicateGroup[]): void {
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

function printTextSummary(issues: readonly LintIssue[], duplicateGroups: readonly CppDuplicateGroup[], scannedFiles: number, summaryOnly: boolean): void {
	if (issues.length === 0 && duplicateGroups.length === 0) {
		console.log('No C++ duplicates or lint issues found.');
		console.log(`Scanned ${scannedFiles} C++ files.`);
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
		printDuplicateSummary(duplicateGroups);
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
	printDuplicateSummary(duplicateGroups);
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

	for (const tool of ['bmsx-cpp', 'clang-tidy', 'cppcheck']) {
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

function quoteCsv(value: string | number | undefined): string {
	const text = `${value ?? ''}`;
	if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r') || text.includes('\t')) {
		return `"${text.replace(/\"/g, '""')}"`;
	}
	return text;
}

function printCsvReport(issues: readonly LintIssue[], duplicateGroups: readonly CppDuplicateGroup[], scannedFiles: number, summaryOnly: boolean): void {
	if (issues.length === 0 && duplicateGroups.length === 0) {
		console.log('file,line,column,tool,check,severity,message');
		console.log(`summary,scanned_files,,,${quoteCsv(scannedFiles)},`);
		console.log('summary,total_issues,0,,,0,');
		return;
	}
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
					quoteCsv('bmsx-cpp'),
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
	console.log(`summary,scanned_files,,,${quoteCsv(scannedFiles)},,`);
	console.log(`summary,total_issues,${issues.length},,,${quoteCsv(issues.length)},`);
	console.log(`summary,total_duplicate_groups,${duplicateGroups.length},,,${quoteCsv(duplicateGroups.length)},`);
	const byCheck = new Map<string, number>();
	for (let i = 0; i < issues.length; i += 1) {
		const issue = issues[i];
		byCheck.set(issue.check, (byCheck.get(issue.check) ?? 0) + 1);
	}
	for (const [check, count] of Array.from(byCheck.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
		console.log(`summary,by_check,${check},,${count},,`);
	}
}

function run(): void {
	const options = parseArgs(process.argv.slice(2));
	const files = collectCppFiles(options.roots);
	if (files.length === 0) {
		console.log('No C++ files found.');
		return;
	}
	let issues: LintIssue[] = [];
	const customAnalysis = analyzeCppFiles(files);
	addBmsxRuleIssues(issues, customAnalysis.lintIssues);
	const compileCommands = resolveCompileCommands(options.roots, options.compileCommands);
	if (hasCommand('clang-tidy')) {
		issues.push(...runClangTidy(files, options.roots, compileCommands, options.configFile));
	} else if (hasCommand('cppcheck')) {
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
		printCsvReport(sortedIssues, customAnalysis.duplicateGroups, files.length, options.summaryOnly);
	} else {
		printTextSummary(sortedIssues, customAnalysis.duplicateGroups, files.length, options.summaryOnly);
	}
	if (options.failOnIssues && (sortedIssues.length > 0 || customAnalysis.duplicateGroups.length > 0)) {
		process.exit(1);
	}
}

run();
