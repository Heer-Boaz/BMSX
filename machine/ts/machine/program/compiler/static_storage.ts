import {
	LuaSyntaxKind,
	type LuaBssDeclarationStatement,
	type LuaChunk,
	type LuaStructDeclarationStatement,
} from '../../../lua/syntax/ast';
import type { LuaSemanticFrontendFile } from '../../../lua/semantic/frontend';
import type { Decl } from '../../../lua/semantic/model';

export type StaticStorageDeclaration =
	| { kind: 'struct'; statement: LuaStructDeclarationStatement }
	| { kind: 'bss'; declaration: Decl; statement: LuaBssDeclarationStatement };

export const collectStaticStorageDeclarations = (
	chunk: LuaChunk,
	semantics: LuaSemanticFrontendFile,
): StaticStorageDeclaration[] => {
	const declarations: StaticStorageDeclaration[] = [];
	for (let index = 0; index < chunk.body.length; index += 1) {
		const statement = chunk.body[index];
		switch (statement.kind) {
			case LuaSyntaxKind.StructDeclarationStatement:
				declarations.push({ kind: 'struct', statement: statement as LuaStructDeclarationStatement });
				break;
			case LuaSyntaxKind.BssDeclarationStatement: {
				const bssStatement = statement as LuaBssDeclarationStatement;
				declarations.push({
					kind: 'bss',
					declaration: semantics.getDeclaration(bssStatement.name.range),
					statement: bssStatement,
				});
				break;
			}
		}
	}
	return declarations;
};

export const hasStaticBssDeclaration = (chunk: LuaChunk): boolean => {
	for (let index = 0; index < chunk.body.length; index += 1) {
		if (chunk.body[index].kind === LuaSyntaxKind.BssDeclarationStatement) {
			return true;
		}
	}
	return false;
};
