import type { LuaIdentifierExpression } from '../lua/syntax/lua_ast';
import type { LuaBoundReference, LuaSemanticFrontendFile } from '../ide/contrib/intellisense/lua_semantic_frontend';

export const IMPLICIT_SELF_SYMBOL_HANDLE = '$implicit:self';

export function getBoundIdentifierReference(
	semantics: LuaSemanticFrontendFile,
	expression: LuaIdentifierExpression,
): LuaBoundReference {
	const reference = semantics.getReference(expression.range);
	if (reference) {
		return reference;
	}
	const decl = semantics.getDeclaration(expression.range);
	if (!decl) {
		throw new Error(`[Compiler] Missing bound reference for identifier '${expression.name}'.`);
	}
	return {
		kind: decl.isGlobal ? 'global' : 'lexical',
		ref: {
			file: decl.file,
			name: decl.name,
			namePath: decl.namePath,
			symbolKey: decl.symbolKey,
			range: expression.range,
			target: decl.id,
			lexicalTarget: decl.isGlobal ? null : decl.id,
			isWrite: true,
			referenceKind: 'identifier',
		},
		decl,
		isImplicitGlobal: false,
	};
}

export function getReferenceSymbolHandle(reference: LuaBoundReference): string | null {
	if (reference.kind === 'lexical' && reference.decl) {
		return reference.decl.id;
	}
	if (reference.kind === 'unresolved' && reference.ref.name === 'self') {
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
