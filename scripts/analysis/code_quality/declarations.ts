import ts from 'typescript';
import { getExpressionText, getPropertyName, hasExportModifier } from '../../../src/bmsx/language/ts/ast/expressions';
import { getFunctionSignature, isFunctionLikeValue } from '../../../src/bmsx/language/ts/ast/functions';
import { getClassScopePath } from '../../lint/rules/ts/support/bindings';
import { getFunctionWrapperTarget, isAbstractClass, isIgnoredMethod } from '../../lint/rules/ts/support/declarations';
import { type ExportedTypeInfo } from '../../lint/rules/code_quality/duplicate_exported_type_name_pattern';
import { ClassInfo, DuplicateGroup, DuplicateKind, DuplicateLocation } from '../../lint/rules/ts/support/types';
import { buildDeclarationDuplicateGroups } from '../duplicate_groups';

export function collectExportedTypes(sourceFile: ts.SourceFile, exportedTypes: ExportedTypeInfo[]): void {
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

export function resolveParentClassInfo(
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

export function isInheritedMethod(
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

export function recordDeclaration(
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

export function getMethodDiscriminator(node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration): string {
	if (ts.isGetAccessorDeclaration(node)) return 'get';
	if (ts.isSetAccessorDeclaration(node)) return 'set';
	return 'method';
}

export function getMethodContext(
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
		const callContext = getObjectLiteralCallContext(container);
		if (callContext !== null) return callContext;
		const objectName = getOwningObjectName(container);
		return objectName === null ? 'object literal' : objectName;
	}
	return null;
}

export function getEnclosingFunctionName(node: ts.Node): string | null {
	let current = node.parent;
	while (current) {
		if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
			return current.name.text;
		}
		if (ts.isMethodDeclaration(current) && current.name !== undefined) {
			return getPropertyName(current.name);
		}
		if ((ts.isFunctionExpression(current) || ts.isArrowFunction(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
			return current.parent.name.text;
		}
		current = current.parent;
	}
	return null;
}

export function getObjectLiteralCallContext(node: ts.ObjectLiteralExpression): string | null {
	const parent = node.parent;
	if (!ts.isCallExpression(parent)) {
		return null;
	}
	const callName = getExpressionText(parent.expression);
	if (callName === null) {
		return null;
	}
	const functionName = getEnclosingFunctionName(node);
	return functionName === null ? `call ${callName}` : `${functionName} ${callName}`;
}

export function getOwningObjectName(node: ts.ObjectLiteralExpression | ts.PropertyAssignment): string | null {
	let current = node.parent;
	while (current) {
		if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
			return getExpressionText(current.left);
		}
		if (ts.isVariableDeclaration(current) && current.name && ts.isIdentifier(current.name)) {
			return current.name.text;
		}
		if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) {
			return current.name.text;
		}
		if (ts.isMethodDeclaration(current) && current.name !== undefined) {
			const name = getPropertyName(current.name);
			return name === null ? null : `${name} result`;
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

function isRecordableClassMemberMethod(node: ts.Node): node is ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration {
	return (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
		&& node.body !== undefined
		&& !isIgnoredMethod(node)
		&& !ts.isObjectLiteralExpression(node.parent);
}

function classInfoForMember(
	node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
	classInfosByKey: Map<string, ClassInfo>,
): ClassInfo | null {
	const container = node.parent;
	if (!ts.isClassDeclaration(container) || container.name === undefined) {
		return null;
	}
	const classScope = getClassScopePath(container);
	if (classScope === null) {
		return null;
	}
	const classInfo = classInfosByKey.get(classScope);
	return classInfo === undefined ? null : classInfo;
}

function recordClassMemberMethodDeclaration(
	node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
	sourceFile: ts.SourceFile,
	buckets: Map<string, DuplicateLocation[]>,
	classInfosByKey: Map<string, ClassInfo>,
	classInfosByName: Map<string, ClassInfo[]>,
	classInfosByFileName: Map<string, Map<string, ClassInfo[]>>,
): boolean {
	const name = getPropertyName(node.name);
	if (name === null) {
		return false;
	}
	const classInfo = classInfoForMember(node, classInfosByKey);
	if (isInheritedMethod(node, classInfo, classInfosByKey, classInfosByName, classInfosByFileName)) {
		return true;
	}
	const position = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
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
	return false;
}

function isFileOrModuleScope(node: ts.Node | undefined): boolean {
	return node !== undefined && (ts.isSourceFile(node) || ts.isModuleBlock(node));
}

function isFileOrModuleScopedVariableDeclaration(node: ts.VariableDeclaration): boolean {
	const list = node.parent;
	return ts.isVariableDeclarationList(list)
		&& ts.isVariableStatement(list.parent)
		&& isFileOrModuleScope(list.parent.parent);
}

export function walkDeclarations(
	sourceFile: ts.SourceFile,
	buckets: Map<string, DuplicateLocation[]>,
	classInfosByKey: Map<string, ClassInfo>,
	classInfosByName: Map<string, ClassInfo[]>,
	classInfosByFileName: Map<string, Map<string, ClassInfo[]>>,
): void {
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined && isFileOrModuleScope(node.parent)) {
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
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunctionLikeValue(node.initializer) && isFileOrModuleScopedVariableDeclaration(node)) {
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
		if (isRecordableClassMemberMethod(node) && recordClassMemberMethodDeclaration(node, sourceFile, buckets, classInfosByKey, classInfosByName, classInfosByFileName)) {
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

export function buildDuplicateGroups(
	buckets: Map<string, DuplicateLocation[]>,
): DuplicateGroup[] {
	return buildDeclarationDuplicateGroups<DuplicateKind, DuplicateLocation>(buckets, (kind, name) => {
		if (kind === 'method') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				return name.slice(name.indexOf('\u0000', firstSep + 1) + 1);
			}
		} else if (kind === 'function' || kind === 'wrapper') {
			const firstSep = name.indexOf('\u0000');
			if (firstSep !== -1) {
				return name.slice(0, firstSep);
			}
		}
		return name;
	});
}
