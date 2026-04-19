import ts from 'typescript';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

type DuplicateKind = 'class' | 'enum' | 'function' | 'interface' | 'method' | 'namespace' | 'type';

type DuplicateLocation = {
	file: string;
	line: number;
	column: number;
	context?: string;
};

type DuplicateGroup = {
	kind: DuplicateKind;
	name: string;
	count: number;
	locations: DuplicateLocation[];
};

const DEFAULT_ROOTS = ['src', 'scripts', 'tests', 'tools'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRECTORIES = new Set([
	'.git',
	'.vscode',
	'.snesmini',
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
]);

type CliOptions = {
	csv: boolean;
	failOnDuplicate: boolean;
	paths: string[];
};

function printHelp(): void {
	console.log('Usage: npx tsx scripts/analysis/duplicate_symbols.ts [--csv] [--fail-on-duplicates] [--root <path> ...]');
	console.log('');
	console.log('Options:');
	console.log('  --csv                  Output CSV report');
	console.log('  --fail-on-duplicates   Exit with code 1 when duplicates are found');
	console.log('  --root <path>          Extra root directory (default: src, scripts, tests, tools)');
	console.log('  --help                 Show this help message');
}

function parseArgs(argv: string[]): CliOptions {
	let failOnDuplicate = false;
	let csv = false;
	const paths: string[] = [];
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
		if (arg === '--fail-on-duplicates') {
			failOnDuplicate = true;
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
			failOnDuplicate,
			paths: DEFAULT_ROOTS,
		};
	}
	return {
		csv,
		failOnDuplicate,
		paths,
	};
}

function resolveInputPath(candidate: string): string {
	return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function shouldSkipDirectory(name: string): boolean {
	return SKIP_DIRECTORIES.has(name) || (name.length > 0 && name[0] === '.');
}

function collectTypeScriptFiles(pathCandidates: ReadonlyArray<string>): string[] {
	const files: string[] = [];
	const stack = pathCandidates.map(resolveInputPath);
	while (stack.length > 0) {
		const current = stack.pop();
		if (!existsSync(current)) continue;
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

function isFunctionLikeValue(node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
	let current: ts.Expression | undefined = node;
	while (current) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		if ((ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion }) .isTypeAssertionExpression?.(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		return ts.isArrowFunction(current) || ts.isFunctionExpression(current);
	}
	return false;
}

function getPropertyName(node: ts.PropertyName | ts.Expression): string | null {
	if (ts.isIdentifier(node)) return node.text;
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return node.text;
	if (ts.isComputedPropertyName(node)) return null;
	if (ts.isPrivateIdentifier(node)) return node.text;
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	return null;
}

function recordDeclaration(
	buckets: Map<string, DuplicateLocation[]>,
	kind: DuplicateKind,
	name: string,
	file: string,
	line: number,
	column: number,
	context?: string,
): void {
	const key = `${kind}:${name}`;
	let list = buckets.get(key);
	if (list === undefined) {
		list = [];
		buckets.set(key, list);
	}
	list.push({
		file,
		line,
		column,
		context,
	});
}

function getMethodContext(
	node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.MethodSignature,
): string | null {
	const container = node.parent;
	if (ts.isClassLike(container) && container.name) {
		const name = getPropertyName(container.name);
		if (name !== null) return `class ${name}`;
	}
	if (ts.isTypeLiteralNode(container)) return 'type literal';
	if (ts.isInterfaceDeclaration(container) && container.name) return `interface ${container.name.text}`;
	if (ts.isObjectLiteralExpression(container)) {
		const objectName = getOwningObjectName(container);
		return objectName === null ? 'object literal' : objectName;
	}
	return null;
}

function getOwningObjectName(node: ts.ObjectLiteralExpression | ts.PropertyAssignment): string | null {
	let current = node.parent;
	while (current) {
		if (ts.isVariableDeclaration(current) && current.name && ts.isIdentifier(current.name)) {
			return current.name.text;
		}
		if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) {
			return current.name.text;
		}
		if (ts.isClassDeclaration(current) && current.name !== undefined) {
			return current.name.text;
		}
		if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
			return current.name.text;
		}
		current = current.parent;
	}
	return null;
}

function walkDeclarations(
	sourceFile: ts.SourceFile,
	buckets: Map<string, DuplicateLocation[]>,
): void {
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(buckets, 'function', name, sourceFile.fileName, position.line + 1, position.character + 1);
			}
		}
		if (ts.isClassDeclaration(node) && node.name !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(buckets, 'class', name, sourceFile.fileName, position.line + 1, position.character + 1);
			}
		}
		if (ts.isInterfaceDeclaration(node)) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(buckets, 'interface', name, sourceFile.fileName, position.line + 1, position.character + 1);
			}
		}
		if (ts.isEnumDeclaration(node)) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(buckets, 'enum', name, sourceFile.fileName, position.line + 1, position.character + 1);
			}
		}
		if (ts.isTypeAliasDeclaration(node)) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(buckets, 'type', name, sourceFile.fileName, position.line + 1, position.character + 1);
			}
		}
		if (ts.isModuleDeclaration(node) && node.name !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(buckets, 'namespace', name, sourceFile.fileName, position.line + 1, position.character + 1);
			}
		}
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunctionLikeValue(node.initializer)) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
			recordDeclaration(buckets, 'function', node.name.text, sourceFile.fileName, position.line + 1, position.character + 1);
		}
		if (ts.isMethodDeclaration(node) && node.body !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(
					buckets,
					'method',
					name,
					sourceFile.fileName,
					position.line + 1,
					position.character + 1,
					getMethodContext(node),
				);
			}
		}
		if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(
					buckets,
					'method',
					name,
					sourceFile.fileName,
					position.line + 1,
					position.character + 1,
					getMethodContext(node),
				);
			}
		}
		if (ts.isMethodSignature(node)) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				recordDeclaration(
					buckets,
					'method',
					name,
					sourceFile.fileName,
					position.line + 1,
					position.character + 1,
					getMethodContext(node),
				);
			}
		}
		if (ts.isPropertyAssignment(node) && isFunctionLikeValue(node.initializer) && getPropertyName(node.name) !== null) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
			const methodName = getPropertyName(node.name);
			if (methodName === null) return;
			recordDeclaration(
				buckets,
				'method',
				methodName,
				sourceFile.fileName,
				position.line + 1,
				position.character + 1,
				getOwningObjectName(node),
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function buildDuplicateGroups(
	buckets: Map<string, DuplicateLocation[]>,
): DuplicateGroup[] {
	const result: DuplicateGroup[] = [];
	for (const [key, locations] of buckets) {
		if (locations.length <= 1) continue;
		const [kind, name] = key.split(':', 2);
		result.push({
			kind: kind as DuplicateKind,
			name,
			count: locations.length,
			locations,
		});
	}
	result.sort((left, right) => {
		if (left.count !== right.count) {
			return right.count - left.count;
		}
		if (left.kind !== right.kind) {
			return left.kind < right.kind ? -1 : 1;
		}
		return left.name < right.name ? -1 : (left.name > right.name ? 1 : 0);
	});
	return result;
}

function formatLocation(location: DuplicateLocation): string {
	if (location.context) {
		return `${location.file}:${location.line}:${location.column} (${location.context})`;
	}
	return `${location.file}:${location.line}:${location.column}`;
}

function printTextReport(groups: DuplicateGroup[], scannedFiles: number): void {
	if (groups.length === 0) {
		console.log('No duplicates found.');
		console.log(`Scanned ${scannedFiles} TypeScript files.`);
		return;
	}
	console.log(`Found ${groups.length} duplicated declaration groups in ${scannedFiles} files.\n`);
	for (const group of groups) {
		console.log(`[${group.kind}] ${group.name} (${group.count}x)`);
		for (const location of group.locations) {
			console.log(`  - ${formatLocation(location)}`);
		}
		if (group.kind === 'interface') {
			console.log('  - interface declarations can legally merge; verify if intentional.');
		}
		console.log('');
	}
}

function quoteCsv(value: string | number | undefined): string {
	const text = `${value ?? ''}`;
	if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r') || text.includes('\t')) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

function printCsvReport(groups: DuplicateGroup[], scannedFiles: number): void {
	console.log(`scanned_files,${quoteCsv(scannedFiles)}`);
	console.log('kind,name,count,file,line,column,context');
	for (const group of groups) {
		for (const location of group.locations) {
			console.log([
				quoteCsv(group.kind),
				quoteCsv(group.name),
				quoteCsv(group.count),
				quoteCsv(location.file),
				quoteCsv(location.line),
				quoteCsv(location.column),
				quoteCsv(location.context ?? ''),
			].join(','));
		}
	}
}

function toRelativePath(path: string): string {
	return relative(process.cwd(), path);
}

function run(): void {
	const options = parseArgs(process.argv.slice(2));
	const fileList = collectTypeScriptFiles(options.paths);
	const buckets = new Map<string, DuplicateLocation[]>();
	for (const filePath of fileList) {
		const sourceText = readFileSync(filePath, 'utf8');
		const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind);
		walkDeclarations(sourceFile, buckets);
	}
	const groups = buildDuplicateGroups(buckets).map(group => ({
		...group,
		locations: group.locations.map(location => ({
			...location,
			file: toRelativePath(location.file),
		})),
	}));
	if (options.csv) {
		printCsvReport(groups, fileList.length);
	} else {
		printTextReport(groups, fileList.length);
	}
	if (options.failOnDuplicate && groups.length > 0) {
		process.exit(1);
	}
}

run();
