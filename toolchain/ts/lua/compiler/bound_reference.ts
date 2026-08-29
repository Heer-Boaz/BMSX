import type { LuaIdentifierExpression } from '../syntax/ast';
import type { LuaBoundReference, LuaSemanticFrontendFile } from '../semantic/frontend';
import type { Decl } from '../semantic/model';

export const IMPLICIT_SELF_SYMBOL_HANDLE = '$implicit:self';

export function getBoundDeclaration(
	semantics: LuaSemanticFrontendFile,
	identifier: LuaIdentifierExpression,
): Decl {
	const declaration = semantics.getDeclaration(identifier);
	if (declaration === undefined) {
		throw new Error(`Missing bound declaration for identifier '${identifier.name}'.`);
	}
	return declaration;
}

export function getBoundIdentifierReference(
	semantics: LuaSemanticFrontendFile,
	expression: LuaIdentifierExpression,
): LuaBoundReference {
	const reference = semantics.getReference(expression);
	if (reference === undefined) {
		throw new Error(`Missing bound reference for identifier '${expression.name}'.`);
	}
	return reference;
}

export function getReferenceSymbolHandle(reference: LuaBoundReference): string | null {
	if (reference.kind === 'lexical' && reference.decl) {
		return reference.decl.id;
	}
	if (reference.kind === 'implicit_self') {
		return IMPLICIT_SELF_SYMBOL_HANDLE;
	}
	return null;
}

export function getIdentifierSymbolHandle(
	semantics: LuaSemanticFrontendFile,
	expression: LuaIdentifierExpression,
): string | null {
	return getReferenceSymbolHandle(getBoundIdentifierReference(semantics, expression));
}
