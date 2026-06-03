import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type AliasRule = { from: string; to: string };
type LayerRule = { name: string; paths: string[] };
type BoundaryRule = { from: string; deny: string[]; reason: string };
type BoundaryConfig = {
	roots: string[];
	tsAliases: AliasRule[];
	cppIncludeRoots: string[];
	layers: LayerRule[];
	rules: BoundaryRule[];
};
type BoundaryIssue = {
	file: string;
	line: number;
	column: number;
	sourceLayer: string;
	targetLayer: string;
	target: string;
	specifier: string;
	reason: string;
};
type CliOptions = {
	configPath: string;
	failOnIssues: boolean;
	summaryOnly: boolean;
};

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const CPP_EXTENSIONS = ['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inl'];
const DEFAULT_CONFIG_PATH = 'scripts/architecture_boundary_rules.json';

function normalizePath(value: string): string {
	return value.split(path.sep).join('/');
}

function repoPath(value: string): string {
	return normalizePath(path.relative(process.cwd(), value));
}

function readConfig(configPath: string): BoundaryConfig {
	return JSON.parse(fs.readFileSync(path.join(process.cwd(), configPath), 'utf8')) as BoundaryConfig;
}

function parseArgs(args: string[]): CliOptions {
	let configPath = DEFAULT_CONFIG_PATH;
	let failOnIssues = false;
	let summaryOnly = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--fail-on-issues') {
			failOnIssues = true;
			continue;
		}
		if (arg === '--summary-only') {
			summaryOnly = true;
			continue;
		}
		if (arg === '--config') {
			configPath = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === '--help') {
			printHelp();
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return { configPath, failOnIssues, summaryOnly };
}

function printHelp(): void {
	console.log('Usage: npx tsx scripts/audit_architecture_boundaries.ts [--summary-only] [--fail-on-issues] [--config <path>]');
}

function collectFiles(root: string, out: string[]): void {
	const fullRoot = path.join(process.cwd(), root);
	if (!fs.existsSync(fullRoot)) return;
	for (const entry of fs.readdirSync(fullRoot, { withFileTypes: true })) {
		const full = path.join(fullRoot, entry.name);
		if (entry.isDirectory()) {
			collectFiles(repoPath(full), out);
			continue;
		}
		if (!entry.isFile()) continue;
		const extension = path.extname(entry.name);
		if (TS_EXTENSIONS.includes(extension) || CPP_EXTENSIONS.includes(extension)) {
			out.push(repoPath(full));
		}
	}
}

function fileMatchesPattern(file: string, pattern: string): boolean {
	if (pattern.endsWith('/**')) {
		const prefix = pattern.slice(0, -3);
		return file === prefix || file.startsWith(`${prefix}/`);
	}
	if (pattern.endsWith('/*.ts')) {
		const prefix = pattern.slice(0, -5);
		return path.posix.dirname(file) === prefix && file.endsWith('.ts');
	}
	return file === pattern;
}

function layerForFile(file: string, config: BoundaryConfig): string | null {
	for (const layer of config.layers) {
		for (const pattern of layer.paths) {
			if (fileMatchesPattern(file, pattern)) return layer.name;
		}
	}
	return null;
}

function boundaryRuleFor(sourceLayer: string, targetLayer: string, config: BoundaryConfig): BoundaryRule | null {
	for (const rule of config.rules) {
		if (rule.from === sourceLayer && rule.deny.includes(targetLayer)) return rule;
	}
	return null;
}

function existingTsCandidate(base: string): string | null {
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.mts`,
		`${base}.cts`,
		path.posix.join(base, 'index.ts'),
		path.posix.join(base, 'index.tsx'),
	];
	for (const candidate of candidates) {
		const fullPath = path.join(process.cwd(), candidate);
		if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) return candidate;
	}
	return null;
}

function resolveTsImport(fromFile: string, specifier: string, config: BoundaryConfig): string | null {
	if (specifier.startsWith('.')) {
		const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)));
		return existingTsCandidate(base);
	}
	for (const alias of config.tsAliases) {
		if (alias.from.endsWith('/')) {
			if (!specifier.startsWith(alias.from)) continue;
			return existingTsCandidate(`${alias.to}${specifier.slice(alias.from.length)}`);
		}
		if (specifier === alias.from) return existingTsCandidate(alias.to);
	}
	return null;
}

function addIssue(
	issues: BoundaryIssue[],
	config: BoundaryConfig,
	file: string,
	line: number,
	column: number,
	sourceLayer: string | null,
	target: string | null,
	specifier: string,
): void {
	if (sourceLayer === null || target === null) return;
	const targetLayer = layerForFile(target, config);
	if (targetLayer === null || targetLayer === sourceLayer) return;
	const rule = boundaryRuleFor(sourceLayer, targetLayer, config);
	if (rule === null) return;
	issues.push({ file, line, column, sourceLayer, targetLayer, target, specifier, reason: rule.reason });
}

function collectTsIssues(file: string, config: BoundaryConfig, issues: BoundaryIssue[]): void {
	const sourceLayer = layerForFile(file, config);
	const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const visit = (node: ts.Node): void => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
			const specifier = node.moduleSpecifier.text;
			const target = resolveTsImport(file, specifier, config);
			const position = source.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(source));
			addIssue(issues, config, file, position.line + 1, position.character + 1, sourceLayer, target, specifier);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}

function existingCppCandidate(base: string): string | null {
	if (fs.existsSync(path.join(process.cwd(), base))) return base;
	return null;
}

function resolveCppInclude(fromFile: string, specifier: string, config: BoundaryConfig): string | null {
	if (specifier.startsWith('.')) {
		return existingCppCandidate(normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))));
	}
	for (const root of config.cppIncludeRoots) {
		const candidate = normalizePath(path.posix.join(root, specifier));
		const resolved = existingCppCandidate(candidate);
		if (resolved !== null) return resolved;
	}
	return null;
}

function collectCppIssues(file: string, config: BoundaryConfig, issues: BoundaryIssue[]): void {
	const sourceLayer = layerForFile(file, config);
	const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
	const lines = source.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^\s*#\s*include\s+"([^"]+)"/.exec(lines[index]);
		if (match === null) continue;
		const specifier = match[1];
		const target = resolveCppInclude(file, specifier, config);
		addIssue(issues, config, file, index + 1, lines[index].indexOf(specifier) + 1, sourceLayer, target, specifier);
	}
}

function printIssues(issues: BoundaryIssue[], summaryOnly: boolean): void {
	const byEdge = new Map<string, number>();
	for (const issue of issues) {
		const key = `${issue.sourceLayer} -> ${issue.targetLayer}`;
		byEdge.set(key, (byEdge.get(key) ?? 0) + 1);
	}
	console.log(`architecture_boundary_issues,${issues.length}`);
	for (const [edge, count] of [...byEdge.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
		console.log(`${edge},${count}`);
	}
	if (summaryOnly) return;
	for (const issue of issues) {
		console.log(`${issue.file}:${issue.line}:${issue.column}: ${issue.sourceLayer} -> ${issue.targetLayer}: ${issue.reason} (${issue.specifier} -> ${issue.target})`);
	}
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));
	const config = readConfig(options.configPath);
	const files: string[] = [];
	for (const root of config.roots) collectFiles(root, files);
	const issues: BoundaryIssue[] = [];
	for (const file of files) {
		const extension = path.extname(file);
		if (TS_EXTENSIONS.includes(extension)) {
			collectTsIssues(file, config, issues);
		} else if (CPP_EXTENSIONS.includes(extension)) {
			collectCppIssues(file, config, issues);
		}
	}
	printIssues(issues, options.summaryOnly);
	if (options.failOnIssues && issues.length > 0) {
		process.exit(1);
	}
}

main();
