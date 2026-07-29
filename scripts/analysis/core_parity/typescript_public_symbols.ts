import path from 'node:path';
import ts from 'typescript';
import type {
	PublicField,
	PublicMethod,
	PublicParameter,
	PublicSignature,
	PublicSymbols,
	PublicTypeSymbol,
} from './public_model';
import { canonicalTypeUnion } from './public_model';

type TypescriptContext = {
	checker: ts.TypeChecker;
};

export function collectTypescriptPublicSymbols(
	repoRoot: string,
	files: readonly string[],
): Map<string, PublicSymbols> {
	const configPath = path.join(repoRoot, 'tsconfig.base.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot, {}, configPath);
	const absoluteFiles = files.map((file) => path.join(repoRoot, file));
	const program = ts.createProgram(absoluteFiles, parsed.options);
	const context: TypescriptContext = { checker: program.getTypeChecker() };
	const result = new Map<string, PublicSymbols>();
	for (let index = 0; index < files.length; index += 1) {
		const source = program.getSourceFile(absoluteFiles[index]);
		if (!source) {
			throw new Error(`TypeScript parity source missing from program: ${files[index]}`);
		}
		result.set(files[index], collectSourceSymbols(source, context));
	}
	return result;
}

function collectSourceSymbols(source: ts.SourceFile, context: TypescriptContext): PublicSymbols {
	const symbols: PublicSymbols = new Map();
	for (const statement of source.statements) {
		if (!hasExportModifier(statement)) {
			continue;
		}
		if (ts.isTypeAliasDeclaration(statement)) {
			const labels = stringLiteralMembers(statement.type);
			symbols.set(
				statement.name.text,
				labels
					? {
						kind: 'enum',
						semanticLabels: true,
						members: labels.map((label) => ({ name: label, value: label })),
					}
					: typeSymbolFromNode(statement.type, context, new Set([statement.name.text])),
			);
			continue;
		}
		if (ts.isInterfaceDeclaration(statement)) {
			symbols.set(statement.name.text, typeSymbolFromInterface(statement, context));
			continue;
		}
		if (ts.isClassDeclaration(statement) && statement.name) {
			symbols.set(statement.name.text, {
				kind: 'type',
				shape: 'record',
				...recordMembers(statement.members, context),
			});
			continue;
		}
		if (ts.isEnumDeclaration(statement)) {
			symbols.set(statement.name.text, {
				kind: 'enum',
				semanticLabels: false,
				members: statement.members.map((member) => {
					const name = propertyName(member.name);
					const value = context.checker.getConstantValue(member);
					if (!name || value === undefined) {
						throw new Error(`${source.fileName}: enum ${statement.name.text} has a non-constant member`);
					}
					return { name, value };
				}),
			});
			continue;
		}
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			if (statement.body && symbols.get(statement.name.text)?.kind === 'function') {
				continue;
			}
			appendFunction(symbols, statement.name.text, signatureFromDeclaration(statement, context));
			continue;
		}
		if (!ts.isVariableStatement(statement)) {
			continue;
		}
		const readonly = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
		for (const declaration of statement.declarationList.declarations) {
			const name = propertyName(declaration.name);
			if (!name) {
				continue;
			}
			if (
				declaration.initializer
				&& (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
			) {
				appendFunction(symbols, name, signatureFromDeclaration(declaration.initializer, context));
				continue;
			}
			symbols.set(name, {
				kind: 'value',
				readonly,
				type: declaration.type
					? typeShape(declaration.type, context, new Set(), false)
					: inferredTypeShape(declaration.name, context),
				value: declaration.initializer ? constantValue(declaration.initializer) : undefined,
			});
		}
	}
	return symbols;
}

function hasExportModifier(node: ts.Node): boolean {
	return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function propertyName(node: ts.PropertyName | ts.BindingName | undefined): string | null {
	if (node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node))) {
		return node.text;
	}
	return null;
}

function typeSymbolFromInterface(
	declaration: ts.InterfaceDeclaration,
	context: TypescriptContext,
): PublicTypeSymbol {
	const result: PublicTypeSymbol = {
		kind: 'type',
		shape: 'record',
		...recordMembers(declaration.members, context),
	};
	if (declaration.heritageClauses) {
		for (const clause of declaration.heritageClauses) {
			for (const type of clause.types) {
				mergeTypeSymbol(result, typeSymbolFromNode(type, context, new Set([declaration.name.text])));
			}
		}
	}
	return result;
}

function typeSymbolFromNode(
	node: ts.TypeNode,
	context: TypescriptContext,
	seen: Set<string>,
): PublicTypeSymbol {
	if (ts.isParenthesizedTypeNode(node)) {
		return typeSymbolFromNode(node.type, context, seen);
	}
	if (ts.isTypeLiteralNode(node)) {
		return { kind: 'type', shape: 'record', ...recordMembers(node.members, context) };
	}
	if (ts.isIntersectionTypeNode(node)) {
		const result: PublicTypeSymbol = { kind: 'type', shape: 'record', fields: [], methods: [] };
		for (const member of node.types) {
			mergeTypeSymbol(result, typeSymbolFromNode(member, context, new Set(seen)));
		}
		return result;
	}
	if (ts.isTypeReferenceNode(node)) {
		const declaration = referencedTypeAlias(node, context);
		if (declaration && !seen.has(declaration.name.text)) {
			const nextSeen = new Set(seen);
			nextSeen.add(declaration.name.text);
			return typeSymbolFromNode(declaration.type, context, nextSeen);
		}
	}
	return {
		kind: 'type',
		shape: typeShape(node, context, seen, false),
		fields: [],
		methods: [],
	};
}

function mergeTypeSymbol(target: PublicTypeSymbol, source: PublicTypeSymbol): void {
	if (source.shape !== 'record') {
		target.shape = source.shape;
		return;
	}
	for (const field of source.fields) {
		const existing = target.fields.find((candidate) => candidate.name === field.name);
		if (!existing) {
			target.fields.push(field);
		}
	}
	for (const method of source.methods) {
		const existing = target.methods.find((candidate) => candidate.name === method.name);
		if (existing) {
			existing.signatures.push(...method.signatures);
		} else {
			target.methods.push(method);
		}
	}
}

function recordMembers(
	members: readonly ts.TypeElement[] | readonly ts.ClassElement[],
	context: TypescriptContext,
): { fields: PublicField[]; methods: PublicMethod[] } {
	const fields: PublicField[] = [];
	const methods = new Map<string, PublicSignature[]>();
	for (const member of members) {
		const flags = ts.getCombinedModifierFlags(member as ts.Declaration);
		if ((flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static)) !== 0) {
			continue;
		}
		if (ts.isConstructorDeclaration(member)) {
			appendMethod(methods, 'constructor', signatureFromDeclaration(member, context));
			for (const parameter of member.parameters) {
				const parameterFlags = ts.getCombinedModifierFlags(parameter);
				if ((parameterFlags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0) {
					continue;
				}
				if ((parameterFlags & (ts.ModifierFlags.Public | ts.ModifierFlags.Readonly)) === 0) {
					continue;
				}
				const name = propertyName(parameter.name);
				if (name) {
					fields.push(fieldFromParameter(name, parameter, context));
				}
			}
			continue;
		}
		const name = propertyName(member.name);
		if (!name) {
			continue;
		}
		if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
			appendMethod(methods, name, signatureFromDeclaration(member, context));
			continue;
		}
		if (ts.isGetAccessorDeclaration(member)) {
			appendMethod(methods, name, signatureFromDeclaration(member, context));
			continue;
		}
		if (ts.isSetAccessorDeclaration(member)) {
			appendMethod(methods, name, signatureFromDeclaration(member, context));
			continue;
		}
		if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
			const optional = !!member.questionToken || typeNodeIncludesAbsence(member.type);
			fields.push({
				name,
				optional,
				type: member.type
					? typeShape(member.type, context, new Set(), optional)
					: inferredTypeShape(member.name, context),
			});
		}
	}
	return {
		fields,
		methods: [...methods].map(([name, signatures]) => ({ name, signatures })),
	};
}

function fieldFromParameter(
	name: string,
	parameter: ts.ParameterDeclaration,
	context: TypescriptContext,
): PublicField {
	const optional = !!parameter.questionToken || !!parameter.initializer || typeNodeIncludesAbsence(parameter.type);
	return {
		name,
		optional,
		type: parameter.type
			? typeShape(parameter.type, context, new Set(), optional)
			: inferredTypeShape(parameter.name, context),
	};
}

function appendMethod(
	methods: Map<string, PublicSignature[]>,
	name: string,
	signature: PublicSignature,
): void {
	const existing = methods.get(name);
	if (existing) {
		existing.push(signature);
	} else {
		methods.set(name, [signature]);
	}
}

function appendFunction(
	symbols: PublicSymbols,
	name: string,
	signature: PublicSignature,
): void {
	const existing = symbols.get(name);
	if (existing?.kind === 'function') {
		existing.signatures.push(signature);
	} else {
		symbols.set(name, { kind: 'function', signatures: [signature] });
	}
}

function signatureFromDeclaration(
	declaration: ts.SignatureDeclaration,
	context: TypescriptContext,
): PublicSignature {
	const parameters: PublicParameter[] = declaration.parameters.map((parameter) => {
		const optional = !!parameter.questionToken || !!parameter.initializer || !!parameter.dotDotDotToken;
		return {
			optional,
			type: parameter.type
				? signatureTypeShape(parameter.type, context)
				: inferredTypeShape(parameter.name, context),
		};
	});
	let returnType = 'void';
	if (ts.isConstructorDeclaration(declaration)) {
		returnType = 'constructor';
	} else if (declaration.type) {
		returnType = signatureTypeShape(declaration.type, context);
	} else {
		const signature = context.checker.getSignatureFromDeclaration(declaration);
		if (signature) {
			returnType = inferredTypeShapeFromType(context.checker.getReturnTypeOfSignature(signature), context);
		}
	}
	return { parameters, returnType };
}

function typeNodeIncludesAbsence(node: ts.TypeNode | undefined): boolean {
	if (!node || !ts.isUnionTypeNode(node)) {
		return false;
	}
	return node.types.some((member) =>
		member.kind === ts.SyntaxKind.UndefinedKeyword
		|| member.kind === ts.SyntaxKind.NullKeyword
		|| (ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword)
	);
}

function signatureTypeShape(node: ts.TypeNode, context: TypescriptContext): string {
	return typeNodeIncludesAbsence(node)
		? `optional(${typeShape(node, context, new Set(), true)})`
		: typeShape(node, context, new Set(), false);
}

function typeShape(
	node: ts.TypeNode,
	context: TypescriptContext,
	seen: Set<string>,
	stripAbsence: boolean,
): string {
	if (ts.isParenthesizedTypeNode(node)) {
		return typeShape(node.type, context, seen, stripAbsence);
	}
	if (ts.isLiteralTypeNode(node)) {
		if (ts.isStringLiteral(node.literal)) return `literal:${node.literal.text}`;
		if (ts.isNumericLiteral(node.literal)) return 'number';
		if (ts.isPrefixUnaryExpression(node.literal) && ts.isNumericLiteral(node.literal.operand)) return 'number';
		if (node.literal.kind === ts.SyntaxKind.TrueKeyword || node.literal.kind === ts.SyntaxKind.FalseKeyword) return 'boolean';
		if (node.literal.kind === ts.SyntaxKind.NullKeyword) return stripAbsence ? 'never' : 'null';
	}
	switch (node.kind) {
		case ts.SyntaxKind.NumberKeyword: return 'number';
		case ts.SyntaxKind.StringKeyword: return 'string';
		case ts.SyntaxKind.BooleanKeyword: return 'boolean';
		case ts.SyntaxKind.VoidKeyword: return 'void';
		case ts.SyntaxKind.AnyKeyword: return 'any';
		case ts.SyntaxKind.UnknownKeyword: return 'unknown';
		case ts.SyntaxKind.NeverKeyword: return 'never';
		case ts.SyntaxKind.NullKeyword: return stripAbsence ? 'never' : 'null';
		case ts.SyntaxKind.UndefinedKeyword: return stripAbsence ? 'never' : 'undefined';
	}
	if (ts.isUnionTypeNode(node)) {
		const members = node.types
			.map((member) => typeShape(member, context, new Set(seen), stripAbsence))
			.filter((member) => member !== 'never');
		return canonicalTypeUnion(members);
	}
	if (ts.isArrayTypeNode(node)) {
		return `sequence(${typeShape(node.elementType, context, seen, false)})`;
	}
	if (ts.isTupleTypeNode(node)) {
		const members = node.elements.map((member) => typeShape(member, context, new Set(seen), false));
		return members.length > 8 && members.every((member) => member === members[0])
			? `sequence(${members[0]})`
			: `tuple(${members.join(',')})`;
	}
	if (ts.isFunctionTypeNode(node)) {
		return 'callable';
	}
	if (ts.isTypeLiteralNode(node)) {
		const index = node.members.find(ts.isIndexSignatureDeclaration);
		if (index?.type && index.parameters[0]?.type) {
			return `map(${typeShape(index.parameters[0].type, context, seen, false)},${typeShape(index.type, context, seen, false)})`;
		}
		const fields = recordMembers(node.members, context).fields
			.map((field) => `${field.name}${field.optional ? '?' : ''}:${field.type}`)
			.sort();
		return `record{${fields.join(',')}}`;
	}
	if (ts.isTypeOperatorNode(node)) {
		return typeShape(node.type, context, seen, stripAbsence);
	}
	if (ts.isTypeReferenceNode(node)) {
		const name = node.typeName.getText();
		switch (name) {
			case 'Readonly':
				if (node.typeArguments?.length === 1) {
					return typeShape(node.typeArguments[0], context, seen, stripAbsence);
				}
				break;
			case 'Array':
			case 'ReadonlyArray':
				if (node.typeArguments?.length === 1) {
					return `sequence(${typeShape(node.typeArguments[0], context, seen, false)})`;
				}
				break;
			case 'Uint8Array':
				return 'bytes';
			case 'Map':
			case 'ReadonlyMap':
			case 'Record':
				if (node.typeArguments?.length === 2) {
					return `map(${typeShape(node.typeArguments[0], context, seen, false)},${typeShape(node.typeArguments[1], context, seen, false)})`;
				}
				break;
		}
		if (/^(?:Uint|Int|Float)\d+Array$/.test(name)) return 'sequence(number)';
		const symbol = referencedSymbol(node, context);
		if (symbol?.flags && (symbol.flags & ts.SymbolFlags.TypeParameter) !== 0) {
			return /(?:Fn|Callback)$/.test(name) ? 'callable' : 'type-param';
		}
		const alias = referencedTypeAlias(node, context);
		if (alias && !seen.has(alias.name.text)) {
			if (stringLiteralMembers(alias.type)) {
				return `enum:${alias.name.text.toLowerCase()}`;
			}
			if (aliasKeepsSemanticName(alias.type)) {
				return `named:${alias.name.text.toLowerCase()}`;
			}
			const nextSeen = new Set(seen);
			nextSeen.add(alias.name.text);
			return typeShape(alias.type, context, nextSeen, stripAbsence);
		}
		if (symbol?.flags && (symbol.flags & ts.SymbolFlags.Enum) !== 0) {
			return `enum:${symbol.name.toLowerCase()}`;
		}
		return `named:${(symbol?.name ?? name).toLowerCase()}`;
	}
	return node.getText().replace(/\s+/g, '');
}

function stringLiteralMembers(node: ts.TypeNode): string[] | null {
	if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
		return [node.literal.text];
	}
	if (!ts.isUnionTypeNode(node)) return null;
	const labels: string[] = [];
	for (const member of node.types) {
		if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
			return null;
		}
		labels.push(member.literal.text);
	}
	return labels;
}

function referencedSymbol(
	node: ts.TypeReferenceNode,
	context: TypescriptContext,
): ts.Symbol | undefined {
	let symbol = context.checker.getSymbolAtLocation(node.typeName);
	if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
		symbol = context.checker.getAliasedSymbol(symbol);
	}
	return symbol;
}

function referencedTypeAlias(
	node: ts.TypeReferenceNode,
	context: TypescriptContext,
): ts.TypeAliasDeclaration | undefined {
	const symbol = referencedSymbol(node, context);
	return symbol?.declarations?.find(ts.isTypeAliasDeclaration);
}

function inferredTypeShape(node: ts.Node, context: TypescriptContext): string {
	return inferredTypeShapeFromType(context.checker.getTypeAtLocation(node), context);
}

function inferredTypeShapeFromType(type: ts.Type, context: TypescriptContext): string {
	if ((type.flags & ts.TypeFlags.NumberLike) !== 0) return 'number';
	if ((type.flags & ts.TypeFlags.StringLike) !== 0) return 'string';
	if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) return 'boolean';
	if ((type.flags & ts.TypeFlags.Void) !== 0) return 'void';
	if (type.isUnion()) {
		return canonicalTypeUnion(type.types.map((member) => inferredTypeShapeFromType(member, context)));
	}
	if (context.checker.isTupleType(type)) {
		const members = context.checker.getTypeArguments(type as ts.TypeReference)
			.map((member) => inferredTypeShapeFromType(member, context));
		return members.length > 8 && members.every((member) => member === members[0])
			? `sequence(${members[0]})`
			: `tuple(${members.join(',')})`;
	}
	if (context.checker.isArrayType(type)) {
		const element = context.checker.getTypeArguments(type as ts.TypeReference)[0];
		return `sequence(${inferredTypeShapeFromType(element, context)})`;
	}
	const name = type.aliasSymbol?.name ?? type.getSymbol()?.name;
	if (name === 'Uint8Array') return 'bytes';
	return name ? `named:${name.toLowerCase()}` : context.checker.typeToString(type).replace(/\s+/g, '');
}

function aliasKeepsSemanticName(node: ts.TypeNode): boolean {
	if (ts.isParenthesizedTypeNode(node)) return aliasKeepsSemanticName(node.type);
	if (ts.isTypeLiteralNode(node) || ts.isIntersectionTypeNode(node)) return true;
	if (!ts.isUnionTypeNode(node)) return false;
	return node.types.some((member) =>
		ts.isTypeLiteralNode(member)
		|| (
			ts.isLiteralTypeNode(member)
			&& (ts.isStringLiteral(member.literal) || member.literal.kind === ts.SyntaxKind.NullKeyword)
		)
	);
}

function constantValue(node: ts.Expression): number | string | boolean | undefined {
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
		const value = Number(node.operand.text);
		return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
	}
	return undefined;
}
