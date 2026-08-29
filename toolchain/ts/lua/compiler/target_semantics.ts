import {
	LuaSyntaxKind,
	LuaUnaryOperator,
	type LuaAssignableExpression,
	type LuaExpression,
	type LuaFunctionDeclarationStatement,
	type LuaUnaryExpression,
} from '../syntax/ast';
import type { LuaBoundReference, LuaSemanticFrontendFile } from '../semantic/frontend';
import { MemoryAccessKind } from '../../../../machine/ts/spec/blua32/memory_access_kind';
import { getMemoryAccessKindForName } from '../memory_access_syntax';
import {
	getBoundIdentifierReference,
	getFunctionDeclarationBoundReferences,
	getReferenceSymbolHandle,
} from './bound_reference';

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
		readonly index: LuaExpression;
	}
	| {
		readonly kind: 'dereference';
		readonly operand: LuaExpression;
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
				if (baseReference.kind === 'map') {
					const accessKind = getMemoryAccessKindForName(baseReference.ref.name);
					if (accessKind === null) {
						throw new Error(`[LuaTargetSemantics] Unsupported memory access target '${baseReference.ref.name}'.`);
					}
					return {
						kind: 'memory',
						baseReference,
						accessKind,
						index: expression.index,
					};
				}
			}
			return {
				kind: 'index',
				base: expression.base,
				index: expression.index,
			};
		case LuaSyntaxKind.UnaryExpression: {
			const unary = expression as LuaUnaryExpression;
			if (unary.operator === LuaUnaryOperator.Dereference) {
				return {
					kind: 'dereference',
					operand: unary.operand,
				};
			}
			throw new Error(`[LuaTargetSemantics] Unsupported unary assignment target.`);
		}
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
		readonly baseReference: LuaBoundReference | null;
		readonly intermediateKeys: ReadonlyArray<string>;
		readonly finalKey: string;
	};

export function classifyFunctionDeclarationTarget(
	semantics: LuaSemanticFrontendFile,
	statement: LuaFunctionDeclarationStatement,
): FunctionDeclarationTarget {
	const { baseReference, finalReference } = getFunctionDeclarationBoundReferences(semantics, statement);
	const path = statement.name.path;
	const method = statement.name.method;
	// Declaration headers are restricted to identifier chains (`fn`, `tbl.fn`,
	// `tbl:method`), so the only flow-visible lexical write is the simple
	// identifier form. Dotted/method forms read the base and then mutate table
	// state, but they do not rewrite the base lexical symbol itself.
	if (path.length === 1 && method === null) {
		let lexicalHandle: string | undefined;
		if (finalReference !== null) {
			lexicalHandle = getReferenceSymbolHandle(finalReference);
		}
		return {
			kind: 'simple',
			lexicalHandle,
			finalReference,
		};
	}
	const finalKey = method === null
		? path[path.length - 1].name
		: method.name;
	const intermediateCount = method === null ? path.length - 2 : path.length - 1;
	const intermediateKeys = new Array<string>(intermediateCount);
	for (let index = 0; index < intermediateCount; index += 1) {
		intermediateKeys[index] = path[index + 1].name;
	}
	return {
		kind: 'path',
		baseReference,
		intermediateKeys,
		finalKey,
	};
}
