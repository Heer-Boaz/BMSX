import {
	LuaSyntaxKind,
	type LuaAssignableExpression,
	type LuaExpression,
	type LuaFunctionDeclarationStatement,
} from '../lua/syntax/lua_ast';
import type { LuaBoundReference, LuaSemanticFrontendFile } from '../ide/contrib/intellisense/lua_semantic_frontend';
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
		readonly index: LuaExpression;
	};

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
					return {
						kind: 'memory',
						baseReference,
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
		readonly finalReference: LuaBoundReference | null;
	}
	| {
		readonly kind: 'path';
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
		return {
			kind: 'simple',
			finalReference,
		};
	}
	return {
		kind: 'path',
		baseReference,
	};
}

export function resolveFunctionDeclarationLexicalHandle(
	semantics: LuaSemanticFrontendFile,
	statement: LuaFunctionDeclarationStatement,
): string | undefined {
	const target = classifyFunctionDeclarationTarget(semantics, statement);
	if (target.kind !== 'simple' || target.finalReference === null) {
		return undefined;
	}
	const handle = getReferenceSymbolHandle(target.finalReference);
	return handle === null ? undefined : handle;
}
