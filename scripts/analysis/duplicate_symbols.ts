import ts from 'typescript';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';

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
	parameters: ts.NodeArray<ts.ParameterDeclaration>;
	typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>;
	type?: ts.TypeNode;
};

function getFunctionSignature(node: FunctionLikeWithSignature): string {
	const typeParameterCount = node.typeParameters?.length ?? 0;
	const parts: string[] = [];
	for (let i = 0; i < node.parameters.length; i += 1) {
		const parameter = node.parameters[i];
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
	const body = node.body;
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

function formatVscodeLocationLink(file: string, line: number, column: number): string {
	const absolute = isAbsolute(file) ? file : resolve(process.cwd(), file);
	const normalized = absolute.replace(/\\/g, '/');
	const relativePath = toRelativePath(normalized);
	return `${relativePath}:${line}:${column}`;
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
				quoteCsv(formatVscodeLocationLink(location.file, location.line, location.column)),
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
	const classInfosByKey = new Map<string, ClassInfo>();
	const classInfosByName = new Map<string, ClassInfo[]>();
	const classInfosByFileName = new Map<string, Map<string, ClassInfo[]>>();
	const sourceFiles: ts.SourceFile[] = [];
	for (const filePath of fileList) {
		const sourceText = readFileSync(filePath, 'utf8');
		const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind);
		sourceFiles.push(sourceFile);
		collectClassInfos(sourceFile, classInfosByKey, classInfosByName, classInfosByFileName);
	}
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
