import {
	LuaSyntaxKind,
	type LuaAssignableExpression,
	type LuaExpression,
	type LuaFunctionDeclarationStatement,
} from '../../lua/syntax/ast';
import type { LuaBoundReference, LuaSemanticFrontendFile } from '../../lua/semantic/frontend';
import { getMemoryAccessKindForName, MemoryAccessKind } from '../memory/access_kind';
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
		// default:
			// throw new Error(`[LuaTargetSemantics] Unsupported assignment target kind: ${String(expression.kind)}`);
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
	const identifiers = statement.name.identifiers;
	const methodName = statement.name.methodName;
	// Declaration headers are restricted to identifier chains (`fn`, `tbl.fn`,
	// `tbl:method`), so the only flow-visible lexical write is the simple
	// identifier form. Dotted/method forms read the base and then mutate table
	// state, but they do not rewrite the base lexical symbol itself.
	if (identifiers.length === 1 && methodName === null) {
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
	const finalKey = methodName === null
		? identifiers[identifiers.length - 1]
		: methodName;
	const intermediateKeys = methodName === null
		? identifiers.slice(1, identifiers.length - 1)
		: identifiers.slice(1);
	return {
		kind: 'path',
		baseReference,
		intermediateKeys,
		finalKey,
	};
}
