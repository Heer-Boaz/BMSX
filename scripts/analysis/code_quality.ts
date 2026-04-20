import ts from 'typescript';

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CodeQualityLintRule } from '../lint/rules';

type DuplicateKind = 'class' | 'enum' | 'function' | 'interface' | 'method' | 'namespace' | 'type' | 'wrapper';

type ClassInfo = {
	key: string;
	fileName: string;
	shortName: string;
	extendsExpression: string | null;
	methods: Set<string>;
};

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

type LintIssue = {
	kind: CodeQualityLintRule;
	file: string;
	line: number;
	column: number;
	name: string;
	message: string;
};

type LintBinding = {
	name: string;
	line: number;
	column: number;
	isConst: boolean;
	hasInitializer: boolean;
	readCount: number;
	writeCount: number;
	isExported: boolean;
	isTopLevel: boolean;
	initializerTextLength: number;
	isSimpleAliasInitializer: boolean;
	firstReadParentKind: ts.SyntaxKind | null;
	firstReadParentOperatorKind: ts.SyntaxKind | null;
};

type RepeatedExpressionInfo = {
	line: number;
	column: number;
	count: number;
};

type ExportedTypeInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
};

type NormalizedBodyInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	fingerprint: string;
};

type FunctionUsageInfo = {
	totalCounts: ReadonlyMap<string, number>;
	referenceCounts: ReadonlyMap<string, number>;
};

const DEFAULT_ROOTS = ['src', 'scripts', 'tests', 'tools'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const LINT_SUMMARY_MAX_FOLDER_SEGMENTS = 5;
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

const HOT_PATH_SEGMENTS = [
	'/src/bmsx/ide/editor/input/',
	'/src/bmsx/ide/editor/render/',
	'/src/bmsx/ide/editor/ui/',
	'/src/bmsx/ide/terminal/ui/',
	'/src/bmsx/ide/workbench/input/',
	'/src/bmsx/ide/workbench/render/',
] as const;

const HOT_PATH_FILES = [
	'/src/bmsx/ide/editor/common/text_layout.ts',
	'/src/bmsx/ide/editor/ui/code_layout.ts',
] as const;

const ENSURE_PATTERN_PATH_SEGMENTS = [
	'/src/bmsx/machine/runtime/',
	'/src/bmsx/render/editor/',
	'/src/bmsx/render/vdp/',
] as const;

const REQUIRED_STATE_ROOTS = new Set([
	'$',
	'editorDocumentState',
	'editorRuntimeState',
	'editorSearchState',
	'editorViewState',
	'editorPointerState',
	'editorCaretState',
	'intellisenseUiState',
	'lineJumpState',
	'referenceState',
	'resourceSearchState',
	'runtimeErrorState',
	'symbolSearchState',
]);

type CliOptions = {
	csv: boolean;
	failOnIssues: boolean;
	summaryOnly: boolean;
	paths: string[];
};

type ProjectLanguage = 'cpp' | 'ts' | 'mixed' | 'unknown';
const CPP_FILE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);

function printHelp(): void {
	console.log('Usage: npx tsx scripts/analysis/code_quality.ts [--csv] [--summary-only] [--fail-on-issues] [--root <path> ...]');
	console.log('');
	console.log('Options:');
	console.log('  --csv                  Output CSV report');
	console.log('  --fail-on-issues       Exit with code 1 when issues are found');
	console.log('  --summary-only         Print only high-level summaries (no per-issue detail)');
	console.log('  --root <path>          Extra root directory (default: src, scripts, tests, tools)');
	console.log('  --help                 Show this help message');
	console.log('');
	console.log('When a C++ folder is detected, extra flags are passed directly to:');
	console.log('  scripts/analysis/code_quality_cpp.ts');
}

function parseArgs(argv: string[]): CliOptions {
	let failOnIssues = false;
	let csv = false;
	let summaryOnly = false;
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
			paths: DEFAULT_ROOTS,
		};
	}
	return {
		csv,
		failOnIssues,
		summaryOnly,
		paths,
	};
}

function extractRootsForLanguageDetection(argv: string[]): string[] {
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
		return DEFAULT_ROOTS;
	}
	return paths;
}

function hasCommand(command: string): boolean {
	const result = spawnSync(command, ['--version'], {
		encoding: 'utf8',
		stdio: 'ignore',
		maxBuffer: 1024 * 1024,
	});
	return result.error === undefined;
}

function runCppQuality(args: readonly string[]): number {
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

function detectProjectLanguage(roots: readonly string[]): ProjectLanguage {
	let hasTypeScript = false;
	let hasCpp = false;
	const stack = roots.map(resolveInputPath);
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined || !existsSync(current)) {
			continue;
		}
		const stats = statSync(current);
		if (stats.isFile()) {
			const extension = extname(current);
			if (FILE_EXTENSIONS.has(extension)) {
				hasTypeScript = true;
			}
			if (CPP_FILE_EXTENSIONS.has(extension)) {
				hasCpp = true;
			}
			if (hasTypeScript && hasCpp) {
				return 'mixed';
			}
			continue;
		}
		if (!stats.isDirectory()) {
			continue;
		}
		const directoryName = basename(current);
		if (shouldSkipDirectory(directoryName)) {
			continue;
		}
		const entries = readdirSync(current, { withFileTypes: true });
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			stack.push(join(current, entry.name));
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

function resolveInputPath(candidate: string): string {
	return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function shouldSkipDirectory(name: string): boolean {
	return SKIP_DIRECTORIES.has(name) || (name.length > 0 && name[0] === '.');
}

function normalizePathForAnalysis(path: string): string {
	return path.replace(/\\/g, '/');
}

function isHotPathFile(fileName: string): boolean {
	const normalized = normalizePathForAnalysis(fileName);
	for (let index = 0; index < HOT_PATH_SEGMENTS.length; index += 1) {
		if (normalized.includes(HOT_PATH_SEGMENTS[index])) {
			return true;
		}
	}
	for (let index = 0; index < HOT_PATH_FILES.length; index += 1) {
		if (normalized.endsWith(HOT_PATH_FILES[index])) {
			return true;
		}
	}
	return false;
}

function isEnsurePatternHotPathFile(fileName: string): boolean {
	const normalized = normalizePathForAnalysis(fileName);
	for (let index = 0; index < ENSURE_PATTERN_PATH_SEGMENTS.length; index += 1) {
		if (normalized.includes(ENSURE_PATTERN_PATH_SEGMENTS[index])) {
			return true;
		}
	}
	return false;
}

function pushLintIssue(
	issues: LintIssue[],
	sourceFile: ts.SourceFile,
	node: ts.Node,
	kind: CodeQualityLintRule,
	message: string,
	name = kind,
): void {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	issues.push({
		kind,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name,
		message,
	});
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

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	const modifiers = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
	if (modifiers === undefined) {
		return false;
	}
	for (let i = 0; i < modifiers.length; i += 1) {
		if (modifiers[i].kind === kind) {
			return true;
		}
	}
	return false;
}

function getClassScopePath(node: ts.Node): string | null {
	const parts: string[] = [];
	let current: ts.Node | undefined = node;
	while (current) {
		if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current) || ts.isModuleDeclaration(current)) {
			if (current.name) {
				const name = getPropertyName(current.name);
				if (name !== null) {
					parts.push(name);
				}
			}
		}
		current = current.parent;
	}
	if (parts.length === 0) {
		return null;
	}
	parts.reverse();
	return parts.join('.');
}

function isAbstractClass(node: ts.ClassDeclaration): boolean {
	return hasModifier(node, ts.SyntaxKind.AbstractKeyword);
}

function isIgnoredMethod(node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration): boolean {
	return hasModifier(node, ts.SyntaxKind.OverrideKeyword) || hasModifier(node, ts.SyntaxKind.AbstractKeyword);
}

function getExtendsExpression(node: ts.ClassDeclaration, importAliases: Map<string, string>): string | null {
	const heritage = node.heritageClauses;
	if (heritage === undefined) {
		return null;
	}
	for (let i = 0; i < heritage.length; i += 1) {
		const clause = heritage[i];
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
			continue;
		}
		const types = clause.types;
		for (let j = 0; j < types.length; j += 1) {
			const expr = types[j].expression;
			const text = getExpressionText(expr, importAliases);
			if (text !== null) {
				return text;
			}
		}
	}
	return null;
}

function getExpressionText(node: ts.Expression, aliases?: Map<string, string>): string | null {
	if (ts.isIdentifier(node)) {
		const alias = aliases?.get(node.text);
		return alias ?? node.text;
	}
	if (ts.isPropertyAccessExpression(node)) {
		const left = getExpressionText(node.expression, aliases);
		if (left === null) {
			return null;
		}
		return `${left}.${node.name.text}`;
	}
	return null;
}

type FunctionLikeWithSignature = {
	parameters?: ts.NodeArray<ts.ParameterDeclaration> | undefined;
	typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>;
	type?: ts.TypeNode;
};

function getFunctionSignature(node: FunctionLikeWithSignature): string {
	const typeParameterCount = node.typeParameters?.length ?? 0;
	const parameters = node.parameters;
	if (parameters === undefined) {
		return `${typeParameterCount}:`;
	}
	const parts: string[] = [];
	for (let i = 0; i < parameters.length; i += 1) {
		const parameter = parameters[i];
		let marker = '';
		if (parameter.dotDotDotToken !== undefined) {
			marker += '...';
		}
		if (parameter.questionToken !== undefined) {
			marker += '?';
		}
		if (parameter.initializer !== undefined) {
			marker += '=';
		}
		if (parameter.name.kind === ts.SyntaxKind.ObjectBindingPattern) {
			marker += 'obj';
		} else if (parameter.name.kind === ts.SyntaxKind.ArrayBindingPattern) {
			marker += 'arr';
		} else {
			marker += 'id';
		}
		parts.push(marker);
	}
	return `${typeParameterCount}:${parts.join(',')}`;
}

function getCallExpressionTarget(node: ts.Expression): string | null {
	let current: ts.Expression = node;
	while (true) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		const isTypeAssertion = (ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion })
			.isTypeAssertionExpression;
		if (isTypeAssertion !== undefined && isTypeAssertion(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		break;
	}
	if (!ts.isCallExpression(current)) {
		return null;
	}
	return getExpressionText(current.expression);
}

function getSingleStatementWrapperTarget(statement: ts.Statement): string | null {
	if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
		return getCallExpressionTarget(statement.expression);
	}
	if (ts.isExpressionStatement(statement)) {
		return getCallExpressionTarget(statement.expression);
	}
	return null;
}

function getFunctionWrapperTarget(
	node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): string | null {
	const name = node.name?.text;
	if (name !== undefined && isBoundaryStyleWrapperName(name)) {
		return null;
	}
	const body = node.body;
	if (body === undefined || body === null) {
		return null;
	}
	if (ts.isBlock(body)) {
		const statements = body.statements;
		if (statements.length === 1) {
			return getSingleStatementWrapperTarget(statements[0]);
		}
		if (statements.length === 2) {
			const first = statements[0];
			const second = statements[1];
			if (ts.isIfStatement(first) && first.elseStatement === undefined) {
				if (ts.isReturnStatement(first.thenStatement) && first.thenStatement.expression === undefined) {
					return getSingleStatementWrapperTarget(second);
				}
			}
		}
		return null;
	}
	return getCallExpressionTarget(body);
}

function collectImportAliases(sourceFile: ts.SourceFile): Map<string, string> {
	const aliases = new Map<string, string>();
	for (let i = 0; i < sourceFile.statements.length; i += 1) {
		const node = sourceFile.statements[i];
		if (!ts.isImportDeclaration(node) || node.importClause === undefined) {
			continue;
		}
		const defaultImport = node.importClause.name;
		if (defaultImport !== undefined) {
			aliases.set(defaultImport.text, defaultImport.text);
		}
		const bindings = node.importClause.namedBindings;
		if (bindings === undefined) {
			continue;
		}
		if (ts.isNamedImports(bindings)) {
			const elements = bindings.elements;
			for (let j = 0; j < elements.length; j += 1) {
				const element = elements[j];
				const importedName = element.propertyName?.text ?? element.name.text;
				aliases.set(element.name.text, importedName);
			}
			continue;
		}
	}
	return aliases;
}

function isVariableImportExportName(node: ts.Node): boolean {
	if (
		ts.isImportClause(node) ||
		ts.isNamespaceImport(node) ||
		ts.isImportSpecifier(node) ||
		ts.isExportSpecifier(node) ||
		ts.isImportEqualsDeclaration(node)
	) {
		return true;
	}
	return false;
}

function isDeclarationIdentifier(node: ts.Identifier, parent: ts.Node): boolean {
	if (ts.isVariableDeclaration(parent)) return parent.name === node;
	if (ts.isParameter(parent)) return parent.name === node;
	if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isMethodDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isEnumDeclaration(parent) || ts.isEnumMember(parent)) {
		return parent.name === node;
	}
	if (ts.isTypeParameterDeclaration(parent)) return parent.name === node;
	if (ts.isPropertyDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertySignature(parent)) {
		return parent.name === node;
	}
	if (ts.isImportClause(parent) && parent.name === node) return true;
	return isVariableImportExportName(parent);
}

function isIdentifierPropertyName(node: ts.Identifier, parent: ts.Node): boolean {
	if (ts.isPropertyAccessExpression(parent)) {
		return parent.name === node;
	}
	if (ts.isPropertyAssignment(parent)) {
		return parent.name === node;
	}
	if (ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) {
		return parent.name === node;
	}
	if (ts.isMethodSignature(parent) || ts.isPropertySignature(parent)) {
		return parent.name === node;
	}
	return false;
}

function isTsAssignmentOperator(kind: ts.SyntaxKind): boolean {
	return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isWriteIdentifier(node: ts.Identifier, parent: ts.Node): boolean {
	if (ts.isBinaryExpression(parent) && isTsAssignmentOperator(parent.operatorToken.kind) && parent.left === node) {
		return true;
	}
	if (ts.isPrefixUnaryExpression(parent) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
		return true;
	}
	if (ts.isPostfixUnaryExpression(parent) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
		return true;
	}
	return false;
}

function isScopeBoundary(node: ts.Node, parent: ts.Node | undefined): boolean {
	if (ts.isSourceFile(node)) {
		return true;
	}
	if (ts.isModuleBlock(node)) {
		return true;
	}
	if (ts.isFunctionLike(node)) {
		return true;
	}
	return ts.isBlock(node) && !ts.isFunctionLike(parent ?? node);
}

function isExportedVariableDeclaration(node: ts.VariableDeclaration): boolean {
	const parent = node.parent;
	if (!parent || !ts.isVariableDeclarationList(parent)) {
		return false;
	}
	const statement = parent.parent;
	if (!statement || !ts.isVariableStatement(statement)) {
		return false;
	}
	const modifiers = statement.modifiers;
	if (!modifiers) {
		return false;
	}
	for (let i = 0; i < modifiers.length; i += 1) {
		if (modifiers[i].kind === ts.SyntaxKind.ExportKeyword) {
			return true;
		}
	}
	return false;
}

function shouldIgnoreLintName(name: string): boolean {
	return name.length === 0 || name === '_' || name.startsWith('_');
}

function isBooleanLiteral(node: ts.Expression): boolean | null {
	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return true;
	}
	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return false;
	}
	return null;
}

function isEmptyStringLiteral(node: ts.Expression): node is ts.StringLiteral {
	return ts.isStringLiteral(node) && node.text === '';
}

function isStringLiteralLike(node: ts.Expression): boolean {
	return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function isNullOrUndefined(node: ts.Expression): boolean {
	return node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined');
}

function isNullishEqualityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
}

function isExpressionInScopeFingerprint(node: ts.Expression): string | null {
	if (ts.isIdentifier(node)) {
		return `id:${node.text}`;
	}
	if (node.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (node.kind === ts.SyntaxKind.SuperKeyword) {
		return 'super';
	}
	if (ts.isPropertyAccessExpression(node)) {
		const left = isExpressionInScopeFingerprint(node.expression);
		if (left === null) {
			return null;
		}
		return `${left}.${node.name.text}`;
	}
	if (ts.isElementAccessExpression(node)) {
		const base = isExpressionInScopeFingerprint(node.expression);
		if (base === null) {
			return null;
		}
		if (ts.isStringLiteral(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression)) {
			return `${base}[${node.argumentExpression.getText()}]`;
		}
		return null;
	}
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
		const inner = ts.isParenthesizedExpression(node)
			? node.expression
			: ts.isAsExpression(node)
				? node.expression
				: node.expression;
		return isExpressionInScopeFingerprint(inner);
	}
	return null;
}

function expressionAccessFingerprint(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (ts.isCallExpression(unwrapped)) {
		return expressionAccessFingerprint(unwrapped.expression);
	}
	return isExpressionInScopeFingerprint(unwrapped);
}

function expressionUsesGuardedValue(expression: ts.Expression, guardFingerprint: string): boolean {
	const expressionFingerprint = expressionAccessFingerprint(expression);
	return expressionFingerprint !== null && (
		expressionFingerprint === guardFingerprint
		|| expressionFingerprint.startsWith(`${guardFingerprint}.`)
		|| expressionFingerprint.startsWith(`${guardFingerprint}[`)
	);
}

function nullishGuardFingerprint(condition: ts.Expression): string | null {
	const unwrapped = unwrapExpression(condition);
	if (!ts.isBinaryExpression(unwrapped)) {
		return null;
	}
	if (unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
		const left = nullishGuardFingerprint(unwrapped.left);
		const right = nullishGuardFingerprint(unwrapped.right);
		return left !== null && left === right ? left : null;
	}
	if (!isNullishEqualityOperator(unwrapped.operatorToken.kind)) {
		return null;
	}
	if (isNullOrUndefined(unwrapped.left)) {
		return expressionAccessFingerprint(unwrapped.right);
	}
	if (isNullOrUndefined(unwrapped.right)) {
		return expressionAccessFingerprint(unwrapped.left);
	}
	return null;
}

function isNullishReturnStatement(statement: ts.Statement): boolean {
	if (ts.isReturnStatement(statement)) {
		return statement.expression !== undefined && isNullOrUndefined(statement.expression);
	}
	if (!ts.isBlock(statement) || statement.statements.length !== 1) {
		return false;
	}
	const onlyStatement = statement.statements[0];
	return ts.isReturnStatement(onlyStatement) && onlyStatement.expression !== undefined && isNullOrUndefined(onlyStatement.expression);
}

function nextStatementAfter(statement: ts.Statement): ts.Statement | null {
	const parent = statement.parent;
	if (!parent || (!ts.isBlock(parent) && !ts.isSourceFile(parent))) {
		return null;
	}
	const statements = parent.statements;
	for (let index = 0; index < statements.length - 1; index += 1) {
		if (statements[index] === statement) {
			return statements[index + 1];
		}
	}
	return null;
}

function previousStatementBefore(statement: ts.Statement): ts.Statement | null {
	const parent = statement.parent;
	if (!parent || (!ts.isBlock(parent) && !ts.isSourceFile(parent))) {
		return null;
	}
	const statements = parent.statements;
	for (let index = 1; index < statements.length; index += 1) {
		if (statements[index] === statement) {
			return statements[index - 1];
		}
	}
	return null;
}

function lintNullishReturnGuard(node: ts.IfStatement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (node.elseStatement !== undefined || !isNullishReturnStatement(node.thenStatement)) {
		return;
	}
	const guardFingerprint = nullishGuardFingerprint(node.expression);
	if (guardFingerprint === null) {
		return;
	}
	const next = nextStatementAfter(node);
	if (next === null || !ts.isReturnStatement(next) || next.expression === undefined) {
		return;
	}
	if (!expressionUsesGuardedValue(next.expression, guardFingerprint)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		'nullish_return_guard_pattern',
		'Nullish guard that only returns null/undefined before returning the guarded value is forbidden. Keep the compact expression form instead of expanding it into a branch.',
	);
}

function isLookupCallExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isCallExpression(unwrapped)
		&& ts.isPropertyAccessExpression(unwrapped.expression)
		&& unwrapped.expression.name.text === 'get';
}

function lintLookupAliasOptionalChain(node: ts.Statement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const previous = previousStatementBefore(node);
	if (previous === null || !ts.isVariableStatement(previous)) {
		return;
	}
	const declarations = previous.declarationList.declarations;
	if (declarations.length !== 1) {
		return;
	}
	const declaration = declarations[0];
	if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || !isLookupCallExpression(declaration.initializer)) {
		return;
	}
	const declarationFingerprint = `id:${declaration.name.text}`;
	if (ts.isIfStatement(node)) {
		if (node.elseStatement !== undefined || !isNullishReturnStatement(node.thenStatement)) {
			return;
		}
		const guardExpression = unwrapExpression(node.expression);
		if (!ts.isPrefixUnaryExpression(guardExpression) || guardExpression.operator !== ts.SyntaxKind.ExclamationToken) {
			return;
		}
		const guardFingerprintText = expressionAccessFingerprint(guardExpression.operand);
		if (guardFingerprintText !== declarationFingerprint) {
			return;
		}
		const next = nextStatementAfter(node);
		if (next === null || !ts.isReturnStatement(next) || next.expression === undefined) {
			return;
		}
		const returnedFingerprint = expressionAccessFingerprint(next.expression);
		if (
			returnedFingerprint === null
			|| returnedFingerprint === declarationFingerprint
			|| (
				!returnedFingerprint.startsWith(`${declarationFingerprint}.`)
				&& !returnedFingerprint.startsWith(`${declarationFingerprint}[`)
			)
		) {
			return;
		}
		pushLintIssue(
			issues,
			sourceFile,
			node,
			'lookup_alias_return_pattern',
			'Temporary lookup alias is forbidden. Inline the lookup expression directly and use optional chaining on it instead.',
		);
		return;
	}
	if (!ts.isReturnStatement(node) || node.expression === undefined) {
		return;
	}
	const returnedFingerprint = expressionAccessFingerprint(node.expression);
	if (
		returnedFingerprint === null
		|| returnedFingerprint === declarationFingerprint
		|| (
			!returnedFingerprint.startsWith(`${declarationFingerprint}.`)
			&& !returnedFingerprint.startsWith(`${declarationFingerprint}[`)
		)
	) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		'lookup_alias_return_pattern',
		'Temporary lookup alias is forbidden. Inline the lookup expression directly and use optional chaining on it instead.',
	);
}

function getSingleReturnExpression(statement: ts.Statement): ts.Expression | null {
	if (ts.isReturnStatement(statement)) {
		return statement.expression ?? null;
	}
	if (!ts.isBlock(statement) || statement.statements.length !== 1) {
		return null;
	}
	const onlyStatement = statement.statements[0];
	if (!ts.isReturnStatement(onlyStatement)) {
		return null;
	}
	return onlyStatement.expression ?? null;
}

function functionBodyContainsLazyInitAssignment(root: ts.Node, targetFingerprint: string): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (current !== root && ts.isFunctionLike(current)) {
			return;
		}
		if (ts.isBinaryExpression(current) && isTsAssignmentOperator(current.operatorToken.kind)) {
			const assignmentTarget = expressionAccessFingerprint(current.left);
			if (assignmentTarget === targetFingerprint) {
				const assignedValue = unwrapExpression(current.right);
				if (
					ts.isCallExpression(assignedValue)
					|| ts.isNewExpression(assignedValue)
					|| ts.isObjectLiteralExpression(assignedValue)
					|| ts.isArrayLiteralExpression(assignedValue)
				) {
					found = true;
					return;
				}
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(root);
	return found;
}

function lintEnsurePattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): void {
	if (!isEnsurePatternHotPathFile(sourceFile.fileName)) {
		return;
	}
	const names = getFunctionNodeUsageNames(node);
	if (names.length === 0 || !names.some(name => name.startsWith('ensure'))) {
		return;
	}
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length < 2) {
		return;
	}
	const lastStatement = body.statements[body.statements.length - 1];
	const returnExpression = getSingleReturnExpression(lastStatement);
	if (returnExpression === null) {
		return;
	}
	const targetFingerprint = expressionAccessFingerprint(returnExpression);
	if (targetFingerprint === null) {
		return;
	}
	let hasGuardReturn = false;
	for (let index = 0; index < body.statements.length - 1; index += 1) {
		const statement = body.statements[index];
		if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) {
			continue;
		}
		const guardReturn = getSingleReturnExpression(statement.thenStatement);
		if (guardReturn === null) {
			continue;
		}
		if (expressionAccessFingerprint(guardReturn) === targetFingerprint) {
			hasGuardReturn = true;
			break;
		}
	}
	if (!hasGuardReturn || !functionBodyContainsLazyInitAssignment(body, targetFingerprint)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.name ?? node,
		'ensure_pattern',
		'Lazy ensure/init wrapper is forbidden. Initialize the resource eagerly instead of guarding creation and returning the cached singleton.',
	);
}

function lintTerminalReturnPaddingPattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): void {
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length === 0) {
		return;
	}
	const lastStatement = body.statements[body.statements.length - 1];
	if (!ts.isReturnStatement(lastStatement) || lastStatement.expression !== undefined) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		lastStatement,
		'useless_terminal_return_pattern',
		'Terminal `return;` is forbidden. Remove no-op returns instead of padding the body.',
	);
}

function unwrapExpression(node: ts.Expression): ts.Expression {
	let current = node;
	while (true) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		const isTypeAssertion = (ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion })
			.isTypeAssertionExpression;
		if (isTypeAssertion !== undefined && isTypeAssertion(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		return current;
	}
}

function isSimpleAliasExpression(node: ts.Expression | undefined): boolean {
	if (node === undefined) {
		return false;
	}
	const unwrapped = unwrapExpression(node);
	return ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped);
}

function normalizeSingleUseContext(node: ts.Node): { kind: ts.SyntaxKind; operatorKind: ts.SyntaxKind | null } {
	let current: ts.Node = node;
	while (
		ts.isParenthesizedExpression(current)
		|| ts.isAsExpression(current)
		|| ts.isNonNullExpression(current)
		|| ((ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion }).isTypeAssertionExpression?.(current) ?? false)
	) {
		current = current.parent;
	}
	return {
		kind: current.kind,
		operatorKind: ts.isBinaryExpression(current) ? current.operatorToken.kind : null,
	};
}

function isSingleUseSuppressingBinaryOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken
		|| kind === ts.SyntaxKind.EqualsEqualsEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
		|| kind === ts.SyntaxKind.LessThanToken
		|| kind === ts.SyntaxKind.LessThanEqualsToken
		|| kind === ts.SyntaxKind.GreaterThanToken
		|| kind === ts.SyntaxKind.GreaterThanEqualsToken
		|| kind === ts.SyntaxKind.AmpersandAmpersandToken
		|| kind === ts.SyntaxKind.BarBarToken
		|| kind === ts.SyntaxKind.QuestionQuestionToken;
}

function shouldReportSingleUseLocal(binding: LintBinding): boolean {
	if (!binding.hasInitializer || !binding.isSimpleAliasInitializer) {
		return false;
	}
	if (binding.initializerTextLength > 32) {
		return false;
	}
	if (
		binding.firstReadParentKind === ts.SyntaxKind.PropertyAccessExpression
		|| binding.firstReadParentKind === ts.SyntaxKind.ElementAccessExpression
	) {
		return false;
	}
	if (
		binding.firstReadParentKind === ts.SyntaxKind.BinaryExpression
		&& binding.firstReadParentOperatorKind !== null
		&& isSingleUseSuppressingBinaryOperator(binding.firstReadParentOperatorKind)
	) {
		return false;
	}
	return true;
}

function isFunctionExpressionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
	return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function incrementUsageCount(counts: Map<string, number>, name: string | null): void {
	if (name === null || name.length === 0) {
		return;
	}
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

function functionUsageExpressionName(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (ts.isIdentifier(unwrapped)) {
		return unwrapped.text;
	}
	if (unwrapped.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		const base = functionUsageExpressionName(unwrapped.expression);
		return base === null ? null : `${base}.${unwrapped.name.text}`;
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		const base = functionUsageExpressionName(unwrapped.expression);
		if (base === null) {
			return null;
		}
		if (ts.isStringLiteral(unwrapped.argumentExpression) || ts.isNumericLiteral(unwrapped.argumentExpression)) {
			return `${base}.${unwrapped.argumentExpression.text}`;
		}
	}
	return null;
}

function incrementExpressionUsageCounts(
	expression: ts.Expression,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
	countAsFunctionReference: boolean,
): void {
	const fullName = functionUsageExpressionName(expression);
	incrementUsageCount(totalCounts, fullName);
	if (countAsFunctionReference) {
		incrementUsageCount(referenceCounts, fullName);
	}
	const unwrapped = unwrapExpression(expression);
	if (ts.isPropertyAccessExpression(unwrapped)) {
		const memberName = `.${unwrapped.name.text}`;
		incrementUsageCount(totalCounts, memberName);
		if (countAsFunctionReference) {
			incrementUsageCount(referenceCounts, memberName);
		}
	}
}

function collectFunctionUsageCountsInExpression(
	expression: ts.Expression | undefined,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
	countAsFunctionReference: boolean,
): void {
	if (expression === undefined) {
		return;
	}
	const unwrapped = unwrapExpression(expression);
	if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
		incrementExpressionUsageCounts(unwrapped, totalCounts, referenceCounts, countAsFunctionReference);
	}
	if (ts.isCallExpression(unwrapped)) {
		incrementExpressionUsageCounts(unwrapped.expression, totalCounts, referenceCounts, false);
		for (let index = 0; index < unwrapped.arguments.length; index += 1) {
			collectFunctionUsageCountsInExpression(unwrapped.arguments[index], totalCounts, referenceCounts, true);
		}
		return;
	}
	if (ts.isNewExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.expression, totalCounts, referenceCounts, false);
		const args = unwrapped.arguments;
		if (args !== undefined) {
			for (let index = 0; index < args.length; index += 1) {
				collectFunctionUsageCountsInExpression(args[index], totalCounts, referenceCounts, true);
			}
		}
		return;
	}
	if (ts.isBinaryExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.left, totalCounts, referenceCounts, false);
		collectFunctionUsageCountsInExpression(unwrapped.right, totalCounts, referenceCounts, true);
		return;
	}
	if (ts.isConditionalExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.condition, totalCounts, referenceCounts, false);
		collectFunctionUsageCountsInExpression(unwrapped.whenTrue, totalCounts, referenceCounts, true);
		collectFunctionUsageCountsInExpression(unwrapped.whenFalse, totalCounts, referenceCounts, true);
		return;
	}
	if (ts.isPrefixUnaryExpression(unwrapped) || ts.isPostfixUnaryExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.operand, totalCounts, referenceCounts, false);
		return;
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.expression, totalCounts, referenceCounts, false);
		return;
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		collectFunctionUsageCountsInExpression(unwrapped.expression, totalCounts, referenceCounts, false);
		collectFunctionUsageCountsInExpression(unwrapped.argumentExpression, totalCounts, referenceCounts, false);
		return;
	}
	if (ts.isObjectLiteralExpression(unwrapped)) {
		for (let index = 0; index < unwrapped.properties.length; index += 1) {
			const property = unwrapped.properties[index];
			if (ts.isPropertyAssignment(property)) {
				collectFunctionUsageCountsInExpression(property.initializer, totalCounts, referenceCounts, true);
			} else if (ts.isSpreadAssignment(property)) {
				collectFunctionUsageCountsInExpression(property.expression, totalCounts, referenceCounts, false);
			}
		}
		return;
	}
	if (ts.isArrayLiteralExpression(unwrapped)) {
		for (let index = 0; index < unwrapped.elements.length; index += 1) {
			collectFunctionUsageCountsInExpression(unwrapped.elements[index], totalCounts, referenceCounts, true);
		}
		return;
	}
	if (ts.isArrowFunction(unwrapped)) {
		if (ts.isBlock(unwrapped.body)) {
			collectFunctionUsageCountsInStatements(unwrapped.body.statements, totalCounts, referenceCounts);
		} else {
			collectFunctionUsageCountsInExpression(unwrapped.body, totalCounts, referenceCounts, true);
		}
		return;
	}
	if (ts.isFunctionExpression(unwrapped)) {
		if (unwrapped.body !== undefined) {
			collectFunctionUsageCountsInStatements(unwrapped.body.statements, totalCounts, referenceCounts);
		}
		return;
	}
	ts.forEachChild(unwrapped, child => {
		if (ts.isExpression(child)) {
			collectFunctionUsageCountsInExpression(child, totalCounts, referenceCounts, false);
		}
	});
}

function collectFunctionUsageCountsInStatements(
	statements: ts.NodeArray<ts.Statement>,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (ts.isExpressionStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
		} else if (ts.isReturnStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, true);
		} else if (ts.isVariableStatement(statement)) {
			for (let declarationIndex = 0; declarationIndex < statement.declarationList.declarations.length; declarationIndex += 1) {
				collectFunctionUsageCountsInExpression(statement.declarationList.declarations[declarationIndex].initializer, totalCounts, referenceCounts, true);
			}
		} else if (ts.isIfStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.thenStatement, totalCounts, referenceCounts);
			if (statement.elseStatement !== undefined) {
				collectFunctionUsageCountsInStatement(statement.elseStatement, totalCounts, referenceCounts);
			}
		} else if (ts.isBlock(statement)) {
			collectFunctionUsageCountsInStatements(statement.statements, totalCounts, referenceCounts);
		} else if (ts.isForStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.condition, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInExpression(statement.incrementor, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.statement, totalCounts, referenceCounts);
		} else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.statement, totalCounts, referenceCounts);
		} else if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
			collectFunctionUsageCountsInExpression(statement.expression, totalCounts, referenceCounts, false);
			collectFunctionUsageCountsInStatement(statement.statement, totalCounts, referenceCounts);
		} else if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
			collectFunctionUsageCountsInStatements(statement.body.statements, totalCounts, referenceCounts);
		} else if (ts.isClassDeclaration(statement)) {
			for (let memberIndex = 0; memberIndex < statement.members.length; memberIndex += 1) {
				const member = statement.members[memberIndex];
				if ((ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && member.body !== undefined) {
					collectFunctionUsageCountsInStatements(member.body.statements, totalCounts, referenceCounts);
				}
			}
		} else {
			ts.forEachChild(statement, child => {
				if (ts.isExpression(child)) {
					collectFunctionUsageCountsInExpression(child, totalCounts, referenceCounts, false);
				} else if (ts.isStatement(child)) {
					collectFunctionUsageCountsInStatement(child, totalCounts, referenceCounts);
				}
			});
		}
	}
}

function collectFunctionUsageCountsInStatement(
	statement: ts.Statement,
	totalCounts: Map<string, number>,
	referenceCounts: Map<string, number>,
): void {
	if (ts.isBlock(statement)) {
		collectFunctionUsageCountsInStatements(statement.statements, totalCounts, referenceCounts);
		return;
	}
	const statements = ts.factory.createNodeArray([statement]);
	collectFunctionUsageCountsInStatements(statements, totalCounts, referenceCounts);
}

function collectFunctionUsageCounts(sourceFiles: readonly ts.SourceFile[]): FunctionUsageInfo {
	const totalCounts = new Map<string, number>();
	const referenceCounts = new Map<string, number>();
	for (let index = 0; index < sourceFiles.length; index += 1) {
		collectFunctionUsageCountsInStatements(sourceFiles[index].statements, totalCounts, referenceCounts);
	}
	return {
		totalCounts,
		referenceCounts,
	};
}

function getFunctionNodeUsageNames(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction): string[] {
	const names: string[] = [];
	if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name !== undefined) {
		names.push(node.name.text);
	}
	if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
		names.push(node.name.text, `.${node.name.text}`);
		const classNode = node.parent;
		if (ts.isClassLike(classNode) && classNode.name !== undefined) {
			names.push(`${classNode.name.text}.${node.name.text}`);
		}
	}
	const parent = node.parent;
	if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
		names.push(parent.name.text);
	}
	if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
		names.push(parent.name.text, `.${parent.name.text}`);
	}
	if (ts.isPropertyAssignment(parent) && ts.isStringLiteral(parent.name)) {
		names.push(parent.name.text, `.${parent.name.text}`);
	}
	return names;
}

function usageCountForNames(names: readonly string[], counts: ReadonlyMap<string, number>): number {
	let total = 0;
	const visited = new Set<string>();
	for (let index = 0; index < names.length; index += 1) {
		const name = names[index];
		if (visited.has(name)) {
			continue;
		}
		visited.add(name);
		total += counts.get(name) ?? 0;
	}
	return total;
}

function isAllowedBySingleLineFunctionUsage(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	usageInfo: FunctionUsageInfo,
): boolean {
	const names = getFunctionNodeUsageNames(node);
	if (names.length === 0) {
		return false;
	}
	if (usageCountForNames(names, usageInfo.totalCounts) >= 2) {
		return true;
	}
	return usageCountForNames(names, usageInfo.referenceCounts) >= 1;
}

function expressionRootName(node: ts.Expression): string | null {
	const current = unwrapExpression(node);
	if (ts.isIdentifier(current)) {
		return current.text;
	}
	if (current.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isPropertyAccessExpression(current)) {
		return expressionRootName(current.expression);
	}
	if (ts.isElementAccessExpression(current)) {
		return expressionRootName(current.expression);
	}
	if (ts.isCallExpression(current)) {
		return expressionRootName(current.expression);
	}
	return null;
}

function hasQuestionDotToken(node: ts.Node): boolean {
	return (node as { questionDotToken?: ts.QuestionDotToken }).questionDotToken !== undefined;
}

function containsClosureExpression(node: ts.Node): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (isFunctionExpressionLike(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

function callTargetText(node: ts.CallExpression | ts.NewExpression): string | null {
	const expression = ts.isCallExpression(node) ? node.expression : node.expression;
	return expression ? getExpressionText(expression) : null;
}

function isNumericDefensiveCall(node: ts.CallExpression): boolean {
	const target = callTargetText(node);
	return target === 'Math.floor'
		|| target === 'Math.round'
		|| target === 'Math.ceil'
		|| target === 'Math.trunc'
		|| target === 'Number.isFinite';
}

function isExpressionChildOfLargerExpression(node: ts.Expression, parent: ts.Node | undefined): boolean {
	if (parent === undefined) {
		return false;
	}
	if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
		return true;
	}
	if (ts.isElementAccessExpression(parent) && parent.expression === node) {
		return true;
	}
	if (ts.isCallExpression(parent) && parent.expression === node) {
		return true;
	}
	if (ts.isNewExpression(parent) && parent.expression === node) {
		return true;
	}
	return false;
}

function repeatedExpressionFingerprint(node: ts.Expression, sourceFile: ts.SourceFile, parent: ts.Node | undefined): string | null {
	if (isExpressionChildOfLargerExpression(node, parent)) {
		return null;
	}
	if (ts.isCallExpression(node)) {
		return null;
	}
	if (
		!ts.isConditionalExpression(node)
		&& !ts.isBinaryExpression(node)
		&& !ts.isElementAccessExpression(node)
		&& !ts.isPropertyAccessExpression(node)
	) {
		return null;
	}
	if (ts.isBinaryExpression(node) && isTsAssignmentOperator(node.operatorToken.kind)) {
		return null;
	}
	const text = node.getText(sourceFile).replace(/\s+/g, ' ');
	if (text.length < 24) {
		return null;
	}
	if (text.startsWith('this.')) {
		return null;
	}
	return text;
}

function isEqualityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken
		|| kind === ts.SyntaxKind.EqualsEqualsEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
}

function collectStringOrChainSubjects(node: ts.Expression, subjects: string[]): boolean {
	if (ts.isParenthesizedExpression(node)) {
		return collectStringOrChainSubjects(node.expression, subjects);
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
		return collectStringOrChainSubjects(node.left, subjects) && collectStringOrChainSubjects(node.right, subjects);
	}
	if (!ts.isBinaryExpression(node) || !isEqualityOperator(node.operatorToken.kind)) {
		return false;
	}
	if (!ts.isStringLiteral(node.left) && !ts.isStringLiteral(node.right)) {
		return false;
	}
	if (ts.isStringLiteral(node.left) && ts.isStringLiteral(node.right)) {
		return false;
	}
	const subject = ts.isStringLiteral(node.left) ? node.right : node.left;
	const subjectKey = isExpressionInScopeFingerprint(subject);
	if (subjectKey === null) {
		return false;
	}
	subjects.push(subjectKey);
	return true;
}

function stringSwitchComparisonSubject(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (!ts.isBinaryExpression(unwrapped) || unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
		return null;
	}
	const leftIsString = isStringLiteralLike(unwrapped.left);
	const rightIsString = isStringLiteralLike(unwrapped.right);
	if (leftIsString === rightIsString) {
		return null;
	}
	const subject = leftIsString ? unwrapped.right : unwrapped.left;
	return isExpressionInScopeFingerprint(subject);
}

function lintStringSwitchChain(node: ts.IfStatement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const parent = node.parent;
	if (ts.isIfStatement(parent) && parent.elseStatement === node) {
		return;
	}
	const subjects: string[] = [];
	let current: ts.IfStatement | undefined = node;
	while (current !== undefined) {
		const subject = stringSwitchComparisonSubject(current.expression);
		if (subject === null) {
			return;
		}
		subjects.push(subject);
		const elseStatement = current.elseStatement;
		if (elseStatement === undefined || !ts.isIfStatement(elseStatement)) {
			break;
		}
		current = elseStatement;
	}
	if (subjects.length < 3) {
		return;
	}
	const first = subjects[0];
	for (let index = 1; index < subjects.length; index += 1) {
		if (subjects[index] !== first) {
			return;
		}
	}
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	issues.push({
		kind: 'string_switch_chain_pattern',
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name: 'string_switch_chain_pattern',
		message: 'Multiple string comparisons against the same expression are forbidden. Use `switch`-statement or lookup table instead.',
	});
}

function lintBinaryExpressionForCodeQuality(
	node: ts.BinaryExpression,
	sourceFile: ts.SourceFile,
	issues: LintIssue[]):
	void {
	if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
		if (isNullOrUndefined(node.right)) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				'nullish_null_normalization_pattern',
				'`?? null`/`?? undefined` normalization is forbidden. Preserve undefined/null directly or handle the case explicitly.',
			);
		}
	}
		if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
			const subjects: string[] = [];
			if (collectStringOrChainSubjects(node, subjects) && subjects.length > 2) {
			const first = subjects[0];
			let sameSubject = true;
			for (let index = 1; index < subjects.length; index += 1) {
				if (subjects[index] !== first) {
					sameSubject = false;
					break;
				}
			}
			if (sameSubject) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
				issues.push({
					kind: 'string_or_chain_comparison_pattern',
					file: sourceFile.fileName,
					line: position.line + 1,
					column: position.character + 1,
					name: 'string_or_chain_comparison_pattern',
					message: 'Multiple OR-comparisons against the same expression with string literals are forbidden. Use `switch`-statement or set-like lookups instead.',
				});
			}
		}
	}
	if (isEqualityOperator(node.operatorToken.kind)) {
		if (
			(isEmptyStringLiteral(node.left) && !ts.isStringLiteral(node.right))
			|| (isEmptyStringLiteral(node.right) && !ts.isStringLiteral(node.left))
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: 'empty_string_condition_pattern',
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: 'empty_string_condition_pattern',
				message: 'Empty-string condition checks are forbidden. Prefer explicit truthy/falsy checks.',
			});
		}
		const leftBoolean = isBooleanLiteral(node.left);
		const rightBoolean = isBooleanLiteral(node.right);
		if ((leftBoolean !== null || rightBoolean !== null) && !(leftBoolean !== null && rightBoolean !== null)) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: 'explicit_truthy_comparison_pattern',
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: 'explicit_truthy_comparison_pattern',
				message: 'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.',
			});
		}
	}
	if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
		if (
			(isEmptyStringLiteral(node.left) && !ts.isStringLiteral(node.right))
			|| (isEmptyStringLiteral(node.right) && !ts.isStringLiteral(node.left))
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: 'empty_string_fallback_pattern',
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: 'empty_string_fallback_pattern',
				message: 'Empty-string fallback via `||` is forbidden. Do not use empty strings as default values.',
			});
		}
		if (
			(isNullOrUndefined(node.left) && !isNullOrUndefined(node.right))
			|| (isNullOrUndefined(node.right) && !isNullOrUndefined(node.left))
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: 'or_nil_fallback_pattern',
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: 'or_nil_fallback_pattern',
				message: '`|| null`/`|| undefined` fallback is forbidden. Use direct checks or nullish coalescing.',
			});
		}
	}
}

function isSingleLineWrapperCandidate(functionNode: ts.Node): boolean {
	if (!ts.isFunctionDeclaration(functionNode) && !ts.isMethodDeclaration(functionNode)) {
		return false;
	}
	const name = functionNode.name?.getText();
	if (name !== undefined && isBoundaryStyleWrapperName(name)) {
		return false;
	}
	const body = functionNode.body;
	if (body === undefined) {
		return false;
	}
	if (!ts.isBlock(body)) {
		return ts.isCallExpression(body) && !isDirectMutationCallExpression(body);
	}
	if (body.statements.length !== 1) {
		return false;
	}
	const statement = body.statements[0];
	if (ts.isReturnStatement(statement)) {
		return statement.expression !== undefined
			&& ts.isCallExpression(statement.expression)
			&& !isDirectMutationCallExpression(statement.expression);
	}
	if (ts.isExpressionStatement(statement)) {
		return ts.isCallExpression(statement.expression) && !isDirectMutationCallExpression(statement.expression);
	}
	return false;
}

function reportSingleLineMethodIssue(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): void {
	const position = sourceFile.getLineAndCharacterOfPosition(node.name?.getStart() ?? node.getStart());
	issues.push({
		kind: 'single_line_method_pattern',
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name: 'single_line_method_pattern',
		message: 'Single-line wrapper function/method is forbidden. Prefer direct logic over delegation wrappers.',
	});
}

// Direct mutations on owned containers are real setters, not delegation wrappers.
const DIRECT_MUTATION_METHOD_NAMES = new Set([
	'add',
	'clear',
	'delete',
	'pop',
	'push',
	'set',
	'shift',
	'splice',
	'unshift',
]);

const BOUNDARY_WRAPPER_NAME_WORDS: ReadonlySet<string> = new Set([
	'acquire',
	'add',
	'append',
	'apply',
	'attach',
	'begin',
	'bind',
	'build',
	'capture',
	'change',
	'clear',
	'copy',
	'configure',
	'create',
	'count',
	'decode',
	'destroy',
	'disable',
	'dispose',
	'detach',
	'encode',
	'enable',
	'end',
	'ensure',
	'focus',
	'format',
	'get',
	'has',
	'ident',
	'init',
	'install',
	'launch',
	'load',
	'make',
	'on',
	'open',
	'emplace',
	'pixels',
	'push',
	'read',
	'release',
	'register',
	'remove',
	'replace',
	'render',
	'reset',
	'resolve',
	'resize',
	'snapshot',
	'save',
	'set',
	'setup',
	'size',
	'state',
	'submit',
	'switch',
	'reserve',
	'shutdown',
	'start',
	'to',
	'update',
	'use',
	'value',
	'write',
	'with',
]);

function isBoundaryStyleWrapperName(name: string): boolean {
	const words = name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	if (words === null) {
		return BOUNDARY_WRAPPER_NAME_WORDS.has(name.toLowerCase());
	}
	for (let index = 0; index < words.length; index += 1) {
		if (BOUNDARY_WRAPPER_NAME_WORDS.has(words[index].toLowerCase())) {
			return true;
		}
	}
	return false;
}

function isDirectMutationReceiver(expression: ts.Expression): boolean {
	let current = expression;
	while (ts.isParenthesizedExpression(current)) {
		current = current.expression;
	}
	if (ts.isIdentifier(current) || current.kind === ts.SyntaxKind.ThisKeyword) {
		return true;
	}
	if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
		return isDirectMutationReceiver(current.expression);
	}
	return false;
}

function isDirectMutationCallExpression(callExpression: ts.CallExpression): boolean {
	if (!ts.isPropertyAccessExpression(callExpression.expression)) {
		return false;
	}
	if (!DIRECT_MUTATION_METHOD_NAMES.has(callExpression.expression.name.text)) {
		return false;
	}
	return isDirectMutationReceiver(callExpression.expression.expression);
}

function hasExportModifier(node: ts.Node): boolean {
	const modifiers = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
	if (!modifiers) {
		return false;
	}
	for (let index = 0; index < modifiers.length; index += 1) {
		if (modifiers[index].kind === ts.SyntaxKind.ExportKeyword) {
			return true;
		}
	}
	return false;
}

function lintFacadeModuleDensity(sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	let exportedCallableCount = 0;
	let exportedWrapperCount = 0;
	let firstWrapperNode: ts.Node | null = null;
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (ts.isFunctionDeclaration(statement) && statement.body !== undefined && hasExportModifier(statement)) {
			exportedCallableCount += 1;
			if (getFunctionWrapperTarget(statement) !== null) {
				exportedWrapperCount += 1;
				firstWrapperNode ??= statement.name ?? statement;
			}
			continue;
		}
		if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
			continue;
		}
		const declarations = statement.declarationList.declarations;
		for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
			const declaration = declarations[declarationIndex];
			if (!isFunctionLikeValue(declaration.initializer)) {
				continue;
			}
			exportedCallableCount += 1;
			if (getFunctionWrapperTarget(declaration.initializer) !== null) {
				exportedWrapperCount += 1;
				firstWrapperNode ??= declaration.name;
			}
		}
	}
	if (exportedWrapperCount >= 3 && exportedWrapperCount * 10 >= exportedCallableCount * 6 && firstWrapperNode !== null) {
		pushLintIssue(
			issues,
			sourceFile,
			firstWrapperNode,
			'facade_module_density_pattern',
			`Module exports ${exportedWrapperCount}/${exportedCallableCount} callable wrappers. Facade modules are forbidden; move ownership to the real module.`,
		);
	}
}

function ideLayer(path: string): string | null {
	const normalized = normalizePathForAnalysis(path);
	const marker = '/src/bmsx/ide/';
	const index = normalized.indexOf(marker);
	if (index === -1) {
		return null;
	}
	const rest = normalized.slice(index + marker.length);
	const slash = rest.indexOf('/');
	return slash === -1 ? rest : rest.slice(0, slash);
}

function forbiddenLayerImportReason(sourceLayer: string, targetLayer: string): string | null {
	if (sourceLayer === targetLayer) {
		return null;
	}
	if (sourceLayer === 'common') {
		return `ide/common must not import ${targetLayer}; common code must stay below feature layers.`;
	}
	if (sourceLayer === 'language' && targetLayer !== 'common') {
		return `ide/language must not import ${targetLayer}; language code must stay UI/workbench independent.`;
	}
	if (sourceLayer === 'terminal' && (targetLayer === 'editor' || targetLayer === 'workbench')) {
		return `ide/terminal must not import ${targetLayer}; terminal code must not depend on editor/workbench internals.`;
	}
	if (sourceLayer === 'editor' && targetLayer === 'workbench') {
		return 'ide/editor must not import ide/workbench; workbench may compose editor, not the reverse.';
	}
	if (sourceLayer === 'workbench' && targetLayer === 'editor') {
		return 'ide/workbench must not import deep editor internals directly; route shared contracts through common modules.';
	}
	if (sourceLayer === 'runtime' && (targetLayer === 'editor' || targetLayer === 'workbench')) {
		return `ide/runtime must not import ${targetLayer}; runtime glue must not own UI feature internals.`;
	}
	return null;
}

function lintCrossLayerImports(sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const sourceLayer = ideLayer(sourceFile.fileName);
	if (sourceLayer === null) {
		return;
	}
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const specifier = statement.moduleSpecifier.text;
		if (!specifier.startsWith('.')) {
			continue;
		}
		const targetPath = resolve(dirname(sourceFile.fileName), specifier);
		const targetLayer = ideLayer(targetPath);
		if (targetLayer === null) {
			continue;
		}
		const reason = forbiddenLayerImportReason(sourceLayer, targetLayer);
		if (reason === null) {
			continue;
		}
		pushLintIssue(
			issues,
			sourceFile,
			statement.moduleSpecifier,
			'cross_layer_import_pattern',
			reason,
		);
	}
}

function collectExportedTypes(sourceFile: ts.SourceFile, exportedTypes: ExportedTypeInfo[]): void {
	for (let index = 0; index < sourceFile.statements.length; index += 1) {
		const statement = sourceFile.statements[index];
		if (!hasExportModifier(statement)) {
			continue;
		}
		if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
			const position = sourceFile.getLineAndCharacterOfPosition(statement.name.getStart(sourceFile));
			exportedTypes.push({
				name: statement.name.text,
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
			});
		}
	}
}

function normalizedAstFingerprint(node: ts.Node): string {
	const parts: string[] = [];
	const visit = (current: ts.Node): void => {
		if (ts.isIdentifier(current)) {
			parts.push('Identifier');
			return;
		}
		if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
			parts.push('StringLiteral');
			return;
		}
		if (ts.isNumericLiteral(current)) {
			parts.push('NumericLiteral');
			return;
		}
		parts.push(ts.SyntaxKind[current.kind]);
		if (ts.isBinaryExpression(current)) {
			parts.push(`op:${ts.SyntaxKind[current.operatorToken.kind]}`);
		}
		if (ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) {
			parts.push(`op:${ts.SyntaxKind[current.operator]}`);
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return parts.join('|');
}

function collectNormalizedBody(
	sourceFile: ts.SourceFile,
	name: string,
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	normalizedBodies: NormalizedBodyInfo[],
): void {
	const body = node.body;
	if (body === undefined || !ts.isBlock(body)) {
		return;
	}
	if (body.statements.length < 2 || isSingleLineWrapperCandidate(node)) {
		return;
	}
	const text = body.getText(sourceFile);
	if (text.length < 120) {
		return;
	}
	const locationNode = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) && node.name
		? node.name
		: body;
	const position = sourceFile.getLineAndCharacterOfPosition(locationNode.getStart(sourceFile));
	normalizedBodies.push({
		name,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		fingerprint: normalizedAstFingerprint(body),
	});
}

function collectNormalizedBodies(sourceFile: ts.SourceFile, normalizedBodies: NormalizedBodyInfo[]): void {
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
			collectNormalizedBody(sourceFile, node.name.text, node, normalizedBodies);
		} else if (ts.isMethodDeclaration(node) && node.body !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				collectNormalizedBody(sourceFile, name, node, normalizedBodies);
			}
		} else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunctionLikeValue(node.initializer)) {
			collectNormalizedBody(sourceFile, node.name.text, node.initializer, normalizedBodies);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function addDuplicateExportedTypeIssues(exportedTypes: readonly ExportedTypeInfo[], issues: LintIssue[]): void {
	const byName = new Map<string, ExportedTypeInfo[]>();
	for (let index = 0; index < exportedTypes.length; index += 1) {
		const entry = exportedTypes[index];
		let list = byName.get(entry.name);
		if (list === undefined) {
			list = [];
			byName.set(entry.name, list);
		}
		list.push(entry);
	}
	for (const [name, list] of byName) {
		if (list.length <= 1) {
			continue;
		}
		for (let index = 0; index < list.length; index += 1) {
			const entry = list[index];
			issues.push({
				kind: 'duplicate_exported_type_name_pattern',
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: 'duplicate_exported_type_name_pattern',
				message: `Exported type/interface name "${name}" is declared ${list.length} times. Shared domain types must have one owner.`,
			});
		}
	}
}

function addNormalizedBodyDuplicateIssues(normalizedBodies: readonly NormalizedBodyInfo[], issues: LintIssue[]): void {
	const byFingerprint = new Map<string, NormalizedBodyInfo[]>();
	for (let index = 0; index < normalizedBodies.length; index += 1) {
		const entry = normalizedBodies[index];
		let list = byFingerprint.get(entry.fingerprint);
		if (list === undefined) {
			list = [];
			byFingerprint.set(entry.fingerprint, list);
		}
		list.push(entry);
	}
	for (const list of byFingerprint.values()) {
		if (list.length <= 1) {
			continue;
		}
		const names = new Set<string>();
		for (let index = 0; index < list.length; index += 1) {
			names.add(list[index].name);
		}
		if (names.size <= 1) {
			continue;
		}
		for (let index = 0; index < list.length; index += 1) {
			const entry = list[index];
			issues.push({
				kind: 'normalized_ast_duplicate_pattern',
				file: entry.file,
				line: entry.line,
				column: entry.column,
				name: 'normalized_ast_duplicate_pattern',
				message: `Function/method body duplicates ${list.length} normalized AST bodies with different names. Extract shared ownership instead of copying logic.`,
			});
		}
	}
}

function collectLintIssues(sourceFile: ts.SourceFile, issues: LintIssue[], functionUsageInfo: FunctionUsageInfo): void {
	const hotPath = isHotPathFile(sourceFile.fileName);
	const scopes: Array<Map<string, LintBinding[]>> = [];
	const repeatedScopes: Array<Map<string, RepeatedExpressionInfo>> = [];
	const enterScope = (): void => {
		scopes.push(new Map<string, LintBinding[]>());
	};
	const enterRepeatedScope = (): void => {
		repeatedScopes.push(new Map<string, RepeatedExpressionInfo>());
	};
	const leaveRepeatedScope = (): void => {
		const scope = repeatedScopes.pop();
		if (!scope) {
			return;
		}
		for (const [text, info] of scope) {
			if (info.count <= 2) {
				continue;
			}
			issues.push({
				kind: 'repeated_expression_pattern',
				file: sourceFile.fileName,
				line: info.line,
				column: info.column,
				name: 'repeated_expression_pattern',
				message: `Expression is repeated ${info.count} times in the same scope: ${text}`,
			});
		}
	};
	const leaveScope = (): void => {
		const scope = scopes.pop();
		if (!scope) {
			return;
		}
		if (scopes.length === 0) {
			return;
		}
		for (const bindings of scope.values()) {
			for (const binding of bindings) {
				if (binding.isTopLevel || binding.isExported || shouldIgnoreLintName(binding.name)) {
					continue;
				}
				if (!binding.isConst && binding.hasInitializer && binding.writeCount === 0) {
					issues.push({
						kind: 'local_const_pattern',
						file: sourceFile.fileName,
						line: binding.line,
						column: binding.column,
						name: 'local_const_pattern',
						message: `Prefer "const" for "${binding.name}"; it is never reassigned.`,
					});
				}
				if (binding.readCount === 1 && shouldReportSingleUseLocal(binding)) {
					issues.push({
						kind: 'single_use_local_pattern',
						file: sourceFile.fileName,
						line: binding.line,
						column: binding.column,
						name: 'single_use_local_pattern',
						message: `Local alias "${binding.name}" is read only once in this scope.`,
					});
				}
			}
		}
	};
	const declareBinding = (declaration: ts.VariableDeclaration, declarationList: ts.VariableDeclarationList): void => {
		if (!ts.isIdentifier(declaration.name)) {
			return;
		}
		const isConst = (declarationList.flags & ts.NodeFlags.Const) !== 0;
		const isLet = (declarationList.flags & ts.NodeFlags.Let) !== 0;
		if (!isConst && !isLet) {
			return;
		}
		const name = declaration.name.text;
		if (shouldIgnoreLintName(name)) {
			return;
		}
		const isTopLevel = scopes.length === 1;
		const scope = scopes[scopes.length - 1];
		if (!scope) {
			return;
		}
		const initializer = declaration.initializer;
		const position = sourceFile.getLineAndCharacterOfPosition(declaration.name.getStart());
		const binding: LintBinding = {
			name,
			line: position.line + 1,
			column: position.character + 1,
			isConst,
			hasInitializer: initializer !== undefined,
			readCount: 0,
			writeCount: 0,
			isExported: isTopLevel && isExportedVariableDeclaration(declaration),
			isTopLevel,
			initializerTextLength: initializer === undefined ? 0 : initializer.getText(sourceFile).replace(/\s+/g, ' ').trim().length,
			isSimpleAliasInitializer: isSimpleAliasExpression(initializer),
			firstReadParentKind: null,
			firstReadParentOperatorKind: null,
		};
		let list = scope.get(name);
		if (list === undefined) {
			list = [];
			scope.set(name, list);
		}
		list.push(binding);
	};
	const markIdentifier = (node: ts.Identifier, parent: ts.Node): void => {
		if (isDeclarationIdentifier(node, parent)) {
			return;
		}
		if (isIdentifierPropertyName(node, parent)) {
			return;
		}
		for (let index = scopes.length - 1; index >= 0; index -= 1) {
			const scope = scopes[index];
			const list = scope.get(node.text);
			if (!list || list.length === 0) {
				continue;
			}
			const binding = list[list.length - 1];
			if (isWriteIdentifier(node, parent)) {
				binding.writeCount += 1;
			} else {
				if (binding.readCount === 0) {
					const useContext = normalizeSingleUseContext(parent);
					binding.firstReadParentKind = useContext.kind;
					binding.firstReadParentOperatorKind = useContext.operatorKind;
				}
				binding.readCount += 1;
			}
			return;
		}
	};
	const recordRepeatedExpression = (node: ts.Expression, parent: ts.Node | undefined): void => {
		const fingerprint = repeatedExpressionFingerprint(node, sourceFile, parent);
		if (fingerprint === null) {
			return;
		}
		const scope = repeatedScopes[repeatedScopes.length - 1];
		if (!scope) {
			return;
		}
		const existing = scope.get(fingerprint);
		if (existing) {
			existing.count += 1;
			return;
		}
		const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		scope.set(fingerprint, {
			line: position.line + 1,
			column: position.character + 1,
			count: 1,
		});
	};
	const lintHotPathCallArguments = (node: ts.CallExpression | ts.NewExpression): void => {
		if (!hotPath) {
			return;
		}
		const args = node.arguments;
		if (args === undefined) {
			return;
		}
		for (let index = 0; index < args.length; index += 1) {
			const argument = args[index];
			const unwrapped = unwrapExpression(argument);
			if (ts.isObjectLiteralExpression(unwrapped) || ts.isArrayLiteralExpression(unwrapped)) {
				pushLintIssue(
					issues,
					sourceFile,
					unwrapped,
					'hot_path_object_literal_pattern',
					'Object/array literal payload allocation in hot-path calls is forbidden. Pass primitives or reuse state/scratch storage.',
				);
			}
			if (isFunctionExpressionLike(unwrapped) || containsClosureExpression(unwrapped)) {
				pushLintIssue(
					issues,
					sourceFile,
					unwrapped,
					'hot_path_closure_argument_pattern',
					'Closure/function argument allocation in hot-path calls is forbidden. Move ownership to direct methods or stable state.',
				);
			}
		}
	};
	const visit = (node: ts.Node, parent: ts.Node | undefined): void => {
		const entered = isScopeBoundary(node, parent);
		const repeatedEntered = ts.isSourceFile(node) || ts.isFunctionLike(node);
		if (entered) {
			enterScope();
		}
		if (repeatedEntered) {
			enterRepeatedScope();
		}
		if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
			declareBinding(node, node.parent);
		}
		if (ts.isIdentifier(node) && parent !== undefined) {
			markIdentifier(node, parent);
		}
		if (ts.isBinaryExpression(node)) {
			lintBinaryExpressionForCodeQuality(node, sourceFile, issues);
		}
			if (ts.isIfStatement(node)) {
				lintNullishReturnGuard(node, sourceFile, issues);
				lintLookupAliasOptionalChain(node, sourceFile, issues);
				lintStringSwitchChain(node, sourceFile, issues);
			}
		if (ts.isReturnStatement(node)) {
			lintLookupAliasOptionalChain(node, sourceFile, issues);
		}
		if (
			ts.isFunctionDeclaration(node)
			|| ts.isMethodDeclaration(node)
			|| ts.isFunctionExpression(node)
			|| ts.isArrowFunction(node)
		) {
			lintEnsurePattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
			lintTerminalReturnPaddingPattern(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
		}
		if (ts.isConditionalExpression(node) && (isNullOrUndefined(node.whenTrue) || isNullOrUndefined(node.whenFalse))) {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				'nullish_null_normalization_pattern',
				'Conditional null/undefined normalization is forbidden. Preserve the actual value or branch explicitly.',
			);
		}
		if (ts.isCallExpression(node)) {
			lintHotPathCallArguments(node);
			if (hotPath && isNumericDefensiveCall(node)) {
				pushLintIssue(
					issues,
					sourceFile,
					node,
					'numeric_defensive_sanitization_pattern',
					'Defensive numeric sanitization in IDE hot paths is forbidden. Coordinates and layout values must already be valid integers.',
				);
			}
		}
		if (ts.isNewExpression(node)) {
			lintHotPathCallArguments(node);
		}
		if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) {
			if (hasQuestionDotToken(node)) {
				const root = expressionRootName(node as ts.Expression);
				if (root !== null && REQUIRED_STATE_ROOTS.has(root)) {
					pushLintIssue(
						issues,
						sourceFile,
						node,
						'defensive_optional_chain_pattern',
						`Optional chaining on required IDE/runtime root "${root}" is forbidden.`,
					);
				}
			}
		}
		if (
			ts.isConditionalExpression(node)
			|| ts.isBinaryExpression(node)
			|| ts.isCallExpression(node)
			|| ts.isElementAccessExpression(node)
			|| ts.isPropertyAccessExpression(node)
		) {
			recordRepeatedExpression(node, parent);
		}
		if (
			(
				ts.isFunctionDeclaration(node)
				|| ts.isMethodDeclaration(node)
				|| ts.isFunctionExpression(node)
				|| ts.isArrowFunction(node)
			) && !ts.isConstructorDeclaration(node)
			&& isSingleLineWrapperCandidate(node)
			&& !isAllowedBySingleLineFunctionUsage(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				functionUsageInfo,
			)
		) {
			reportSingleLineMethodIssue(
				node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
				sourceFile,
				issues,
			);
		}
		ts.forEachChild(node, child => visit(child, node));
		if (repeatedEntered) {
			leaveRepeatedScope();
		}
		if (entered) {
			leaveScope();
		}
	};
	visit(sourceFile, undefined);
	lintFacadeModuleDensity(sourceFile, issues);
	lintCrossLayerImports(sourceFile, issues);
}

function collectClassInfos(
	sourceFile: ts.SourceFile,
	classInfosByKey: Map<string, ClassInfo>,
	classInfosByName: Map<string, ClassInfo[]>,
	classInfosByFileName: Map<string, Map<string, ClassInfo[]>>,
): void {
	const importAliases = collectImportAliases(sourceFile);
	const visit = (node: ts.Node): void => {
		if (ts.isClassDeclaration(node) && node.name !== undefined) {
			const key = getClassScopePath(node);
			if (key === null) {
				return;
			}
			const methods = new Set<string>();
			for (let i = 0; i < node.members.length; i += 1) {
				const member = node.members[i];
				if (
					!ts.isMethodDeclaration(member) &&
					!ts.isGetAccessorDeclaration(member) &&
					!ts.isSetAccessorDeclaration(member)
				) {
					continue;
				}
				const methodName = getPropertyName(member.name);
				if (methodName === null) {
					continue;
				}
				methods.add(`${getMethodDiscriminator(member)}:${methodName}`);
			}
			const classInfo: ClassInfo = {
				key,
				fileName: sourceFile.fileName,
				shortName: node.name.text,
				extendsExpression: getExtendsExpression(node, importAliases),
				methods,
			};
			classInfosByKey.set(key, classInfo);
			let list = classInfosByName.get(node.name.text);
			if (list === undefined) {
				list = [];
				classInfosByName.set(node.name.text, list);
			}
			list.push(classInfo);
			let byName = classInfosByFileName.get(sourceFile.fileName);
			if (byName === undefined) {
				byName = new Map<string, ClassInfo[]>();
				classInfosByFileName.set(sourceFile.fileName, byName);
			}
			let fileScopedList = byName.get(node.name.text);
			if (fileScopedList === undefined) {
				fileScopedList = [];
				byName.set(node.name.text, fileScopedList);
			}
			fileScopedList.push(classInfo);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

function resolveParentClassInfo(
	info: ClassInfo,
	classInfosByKey: Map<string, ClassInfo>,
	classInfosByName: Map<string, ClassInfo[]>,
	classInfosByFileName: Map<string, Map<string, ClassInfo[]>>,
): ClassInfo | null {
	if (info.extendsExpression === null) {
		return null;
	}
	const exact = classInfosByKey.get(info.extendsExpression);
	if (exact !== undefined) {
		return exact;
	}
	const sameFile = classInfosByFileName.get(info.fileName);
	if (sameFile !== undefined) {
		const fileScoped = sameFile.get(info.extendsExpression);
		if (fileScoped !== undefined && fileScoped.length > 0) {
			return fileScoped[0];
		}
	}
	const candidates = classInfosByName.get(info.extendsExpression);
	if (candidates === undefined || candidates.length === 0) {
		return null;
	}
	for (let i = 0; i < candidates.length; i += 1) {
		if (candidates[i].key === info.key) {
			continue;
		}
		return candidates[i];
	}
	return candidates[0];
}

function isInheritedMethod(
	method: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
	classInfo: ClassInfo | null,
	classInfosByKey: Map<string, ClassInfo>,
	classInfosByName: Map<string, ClassInfo[]>,
	classInfosByFileName: Map<string, Map<string, ClassInfo[]>>,
): boolean {
	if (classInfo === null) {
		return false;
	}
	const name = getPropertyName(method.name);
	if (name === null) {
		return false;
	}
	const methodKey = `${getMethodDiscriminator(method)}:${name}`;
	let current: ClassInfo | null = resolveParentClassInfo(
		classInfo,
		classInfosByKey,
		classInfosByName,
		classInfosByFileName,
	);
	const visited = new Set<string>();
	while (current !== null) {
		if (visited.has(current.key)) {
			return false;
		}
		visited.add(current.key);
		if (current.methods.has(methodKey)) {
			return true;
		}
		current = resolveParentClassInfo(current, classInfosByKey, classInfosByName, classInfosByFileName);
	}
	return false;
}

function recordDeclaration(
	buckets: Map<string, DuplicateLocation[]>,
	kind: DuplicateKind,
	name: string,
	file: string,
	line: number,
	column: number,
	context?: string,
	keyHint?: string,
): void {
	let key: string;
	if (kind === 'method' && context !== undefined) {
		key = `method\u0000${keyHint ?? 'method'}\u0000${context}\u0000${name}`;
	} else if (kind === 'function') {
		key = `function\u0000${name}\u0000${keyHint ?? 'default'}`;
	} else if (kind === 'wrapper') {
		key = `wrapper\u0000${name}\u0000${context ?? 'delegate'}`;
	} else {
		key = `${kind}\u0000${name}`;
	}
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

function getMethodDiscriminator(node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration): string {
	if (ts.isGetAccessorDeclaration(node)) return 'get';
	if (ts.isSetAccessorDeclaration(node)) return 'set';
	return 'method';
}

function getMethodContext(
	node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.MethodSignature,
): string | null {
	const container = node.parent;
	if (ts.isClassLike(container) && container.name) {
		const scope = getClassScopePath(container);
		if (scope !== null) return `class ${scope}`;
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
	classInfosByKey: Map<string, ClassInfo>,
	classInfosByName: Map<string, ClassInfo[]>,
	classInfosByFileName: Map<string, Map<string, ClassInfo[]>>,
): void {
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				const signature = getFunctionSignature(node);
				const wrapperTarget = getFunctionWrapperTarget(node);
				if (wrapperTarget === null) {
					recordDeclaration(
						buckets,
						'function',
						name,
						sourceFile.fileName,
						position.line + 1,
						position.character + 1,
						undefined,
						signature,
					);
				} else {
					recordDeclaration(
						buckets,
						'wrapper',
						name,
						sourceFile.fileName,
						position.line + 1,
						position.character + 1,
						wrapperTarget,
					);
				}
			}
		}
		if (ts.isClassDeclaration(node) && node.name !== undefined && !isAbstractClass(node)) {
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
			const signature = getFunctionSignature(node.initializer);
			const wrapperTarget = getFunctionWrapperTarget(node.initializer);
			if (wrapperTarget === null) {
				recordDeclaration(
					buckets,
					'function',
					node.name.text,
					sourceFile.fileName,
					position.line + 1,
					position.character + 1,
					undefined,
					signature,
				);
			} else {
					recordDeclaration(
						buckets,
						'wrapper',
						node.name.text,
						sourceFile.fileName,
						position.line + 1,
						position.character + 1,
						wrapperTarget,
					);
			}
		}
		if (ts.isMethodDeclaration(node) && node.body !== undefined && !isIgnoredMethod(node)) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				const container = node.parent;
				const classScope = ts.isClassDeclaration(container) && container.name !== undefined ? getClassScopePath(container) : null;
				const classInfo = classScope === null ? null : classInfosByKey.get(classScope);
				if (isInheritedMethod(node, classInfo, classInfosByKey, classInfosByName, classInfosByFileName)) {
					return;
				}
				recordDeclaration(
					buckets,
					'method',
					name,
					sourceFile.fileName,
					position.line + 1,
					position.character + 1,
					getMethodContext(node),
					getMethodDiscriminator(node),
				);
			}
		}
		if (
			(ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
			node.body !== undefined &&
			!isIgnoredMethod(node)
		) {
			const name = getPropertyName(node.name);
			if (name !== null) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
				const container = node.parent;
				const classScope = ts.isClassDeclaration(container) && container.name !== undefined ? getClassScopePath(container) : null;
				const classInfo = classScope === null ? null : classInfosByKey.get(classScope);
				if (isInheritedMethod(node, classInfo, classInfosByKey, classInfosByName, classInfosByFileName)) {
					return;
				}
				recordDeclaration(
					buckets,
					'method',
					name,
					sourceFile.fileName,
					position.line + 1,
					position.character + 1,
					getMethodContext(node),
					getMethodDiscriminator(node),
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
		const split = key.indexOf('\u0000');
		if (split === -1) {
			continue;
		}
		const kind = key.slice(0, split) as DuplicateKind;
		if (kind !== 'wrapper' && locations.length <= 1) {
			continue;
		}
		let name = key.slice(split + 1);
		if (kind === 'method') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				name = name.slice(name.indexOf('\u0000', firstSep + 1) + 1);
			}
		} else if (kind === 'function' || kind === 'wrapper') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				name = name.slice(0, firstSep);
			}
		}
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
	const link = formatVscodeLocationLink(location.file, location.line, location.column);
	if (location.context) {
		return `${link} (${location.context})`;
	}
	return link;
}

function formatLintIssue(issue: LintIssue): string {
	const link = formatVscodeLocationLink(issue.file, issue.line, issue.column);
	return `${link}: ${issue.message} (${issue.name})`;
}

function formatVscodeLocationLink(file: string, line: number, column: number): string {
	const absolute = isAbsolute(file) ? file : resolve(process.cwd(), file);
	const normalized = absolute.replace(/\\/g, '/');
	const relativePath = toRelativePath(normalized);
	return `${relativePath}:${line}:${column}`;
}

type FolderLintSummary = {
	folder: string;
	total: number;
	byRule: Map<string, number>;
};

function getLintSummaryFolder(file: string): string {
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

function formatPercent(numerator: number, denominator: number): string {
	if (denominator <= 0) {
		return '0.0%';
	}
	return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function printLintSummary(lintIssues: readonly LintIssue[]): void {
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

function printCsvLintSummaryRows(lintIssues: readonly LintIssue[]): void {
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

function printCsvDuplicateSummaryRows(groups: readonly DuplicateGroup[]): void {
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
			quoteCsv(`duplicate_kind:${kind[0]}`),
			quoteCsv(count),
			quoteCsv(''),
			quoteCsv(percent),
			quoteCsv(''),
			quoteCsv(''),
			quoteCsv(`Duplicate declarations by kind "${kind[0]}" (${percent})`),
		].join(','));
	}
}

function printDuplicateSummary(groups: readonly DuplicateGroup[]): void {
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

function printTextReport(groups: DuplicateGroup[], lintIssues: LintIssue[], scannedFiles: number, summaryOnly: boolean): void {
	if (groups.length === 0 && lintIssues.length === 0) {
		console.log('No duplicates or lint issues found.');
		console.log(`Scanned ${scannedFiles} TypeScript files.`);
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
		const issuesByKind = new Map<CodeQualityLintRule, LintIssue[]>();
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
}

function quoteCsv(value: string | number | undefined): string {
	const text = `${value ?? ''}`;
	if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r') || text.includes('\t')) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

function printCsvReport(groups: DuplicateGroup[], lintIssues: LintIssue[], scannedFiles: number, summaryOnly: boolean): void {
	console.log(`scanned_files,${quoteCsv(scannedFiles)}`);
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
	printCsvDuplicateSummaryRows(groups);
	printCsvLintSummaryRows(lintIssues);
}

function toRelativePath(path: string): string {
	return relative(process.cwd(), path);
}

function run(): void {
	const argv = process.argv.slice(2);
	if (argv.includes('--help')) {
		parseArgs(argv);
		return;
	}
	const inferredRoots = extractRootsForLanguageDetection(argv);
	const language = detectProjectLanguage(inferredRoots);
	if (language === 'cpp') {
		const exitCode = runCppQuality(argv);
		if (exitCode !== 0) {
			process.exit(exitCode);
		}
		return;
	}
	const options = parseArgs(argv);
	if (language === 'mixed') {
		throw new Error('Mixed TypeScript and C++ sources detected. Run the analyzer on one language folder at a time.');
	}
	if (language === 'unknown') {
		console.log('No TypeScript or C++ files found in the provided roots.');
		return;
	}
	const fileList = collectTypeScriptFiles(options.paths);
	const buckets = new Map<string, DuplicateLocation[]>();
	const classInfosByKey = new Map<string, ClassInfo>();
	const classInfosByName = new Map<string, ClassInfo[]>();
	const classInfosByFileName = new Map<string, Map<string, ClassInfo[]>>();
	const lintIssues: LintIssue[] = [];
	const sourceFiles: ts.SourceFile[] = [];
	const exportedTypes: ExportedTypeInfo[] = [];
	const normalizedBodies: NormalizedBodyInfo[] = [];
	for (const filePath of fileList) {
		const sourceText = readFileSync(filePath, 'utf8');
		const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind);
		sourceFiles.push(sourceFile);
		collectClassInfos(sourceFile, classInfosByKey, classInfosByName, classInfosByFileName);
		collectExportedTypes(sourceFile, exportedTypes);
		collectNormalizedBodies(sourceFile, normalizedBodies);
	}
	const functionUsageInfo = collectFunctionUsageCounts(sourceFiles);
	for (const sourceFile of sourceFiles) {
		collectLintIssues(sourceFile, lintIssues, functionUsageInfo);
	}
	addDuplicateExportedTypeIssues(exportedTypes, lintIssues);
	addNormalizedBodyDuplicateIssues(normalizedBodies, lintIssues);
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
	const normalizedLintIssues = lintIssues.map(issue => ({
		...issue,
		file: toRelativePath(issue.file),
	}));
	if (options.csv) {
		printCsvReport(groups, normalizedLintIssues, fileList.length, options.summaryOnly);
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
		printTextReport(groups, sortedIssues, fileList.length, options.summaryOnly);
	}
	if (options.failOnIssues && (groups.length > 0 || normalizedLintIssues.length > 0)) {
		process.exit(1);
	}
}

run();
