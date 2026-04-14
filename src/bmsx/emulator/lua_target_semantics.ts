import {
	LuaSyntaxKind,
	type LuaAssignableExpression,
	type LuaExpression,
	type LuaFunctionDeclarationStatement,
} from '../lua/syntax/lua_ast';
import type { LuaBoundReference, LuaSemanticFrontendFile } from '../ide/contrib/intellisense/lua_semantic_frontend';
import { MemoryAccessKind } from './cpu';
import {
	getBoundIdentifierReference,
	getFunctionDeclarationBoundReferences,
	getReferenceSymbolHandle,
} from './lua_bound_reference';

export type AssignmentTargetPreparation =
	| {
		readonly kind: 'identifier';
	}
	| {
		readonly kind: 'member';
		readonly base: LuaExpression;
	}
	| {
		readonly kind: 'index';
		readonly base: LuaExpression;
		readonly index: LuaExpression;
	}
	| {
		readonly kind: 'memory';
		readonly baseReference: LuaBoundReference;
		readonly accessKind: MemoryAccessKind;
		readonly memoryName: string;
		readonly index: LuaExpression;
	};

function normalizeMemoryTargetName(name: string): string {
	return name.toLowerCase();
}

function resolveMemoryAccessKind(name: string): MemoryAccessKind | null {
	switch (normalizeMemoryTargetName(name)) {
		case 'mem':
			return MemoryAccessKind.Word;
		case 'mem8':
			return MemoryAccessKind.U8;
		case 'mem16le':
			return MemoryAccessKind.U16LE;
		case 'mem32le':
			return MemoryAccessKind.U32LE;
		case 'memf32le':
			return MemoryAccessKind.F32LE;
		case 'memf64le':
			return MemoryAccessKind.F64LE;
		default:
			return null;
	}
}

export function classifyAssignmentTargetPreparation(
	semantics: LuaSemanticFrontendFile,
	expression: LuaAssignableExpression,
): AssignmentTargetPreparation {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return { kind: 'identifier' };
		case LuaSyntaxKind.MemberExpression:
			return {
				kind: 'member',
				base: expression.base,
			};
		case LuaSyntaxKind.IndexExpression:
			if (expression.base.kind === LuaSyntaxKind.IdentifierExpression) {
				const baseReference = getBoundIdentifierReference(semantics, expression.base);
				if (baseReference.kind === 'memory_map') {
					const memoryName = normalizeMemoryTargetName(baseReference.ref.name);
					const accessKind = resolveMemoryAccessKind(memoryName);
					if (accessKind === null) {
						throw new Error(`[LuaTargetSemantics] Unsupported memory access target '${memoryName}'.`);
					}
					return {
						kind: 'memory',
						baseReference,
						accessKind,
						memoryName,
						index: expression.index,
					};
				}
			}
			return {
				kind: 'index',
				base: expression.base,
				index: expression.index,
			};
		default:
			throw new Error(`[LuaTargetSemantics] Unsupported assignment target kind: ${String(expression.kind)}`);
	}
}

export type FunctionDeclarationTarget =
	| {
		readonly kind: 'simple';
		readonly lexicalHandle: string | undefined;
		readonly finalReference: LuaBoundReference | null;
	}
	| {
		readonly kind: 'path';
		readonly baseLoad: LuaBoundReference | null;
		readonly intermediateKeys: ReadonlyArray<string>;
		readonly finalKey: string;
		readonly baseReference: LuaBoundReference | null;
	};

export function classifyFunctionDeclarationTarget(
	semantics: LuaSemanticFrontendFile,
	statement: LuaFunctionDeclarationStatement,
): FunctionDeclarationTarget {
	const { baseReference, finalReference } = getFunctionDeclarationBoundReferences(semantics, statement);
	// Declaration headers are restricted to identifier chains (`fn`, `tbl.fn`,
	// `tbl:method`), so the only flow-visible lexical write is the simple
	// identifier form. Dotted/method forms read the base and then mutate table
	// state, but they do not rewrite the base lexical symbol itself.
	if (statement.name.identifiers.length === 1 && statement.name.methodName === null) {
		const lexicalHandle = finalReference === null ? undefined : getReferenceSymbolHandle(finalReference) ?? undefined;
		return {
			kind: 'simple',
			lexicalHandle,
			finalReference,
		};
	}
	const identifiers = statement.name.identifiers;
	const finalKey = statement.name.methodName === null
		? identifiers[identifiers.length - 1]
		: statement.name.methodName;
	const intermediateKeys = statement.name.methodName === null
		? identifiers.slice(1, identifiers.length - 1)
		: identifiers.slice(1);
	return {
		kind: 'path',
		baseLoad: baseReference,
		intermediateKeys,
		finalKey,
		baseReference,
	};
}

export function resolveFunctionDeclarationLexicalHandle(
	semantics: LuaSemanticFrontendFile,
	statement: LuaFunctionDeclarationStatement,
): string | undefined {
	const target = classifyFunctionDeclarationTarget(semantics, statement);
	if (target.kind !== 'simple') {
		return undefined;
	}
	return target.lexicalHandle;
}
