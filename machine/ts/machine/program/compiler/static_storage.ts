import {
	LuaSyntaxKind,
	type LuaBssDeclarationStatement,
	type LuaDataDeclarationStatement,
	type LuaRodataDeclarationStatement,
	type LuaChunk,
	type LuaStructDeclarationStatement,
} from '../../../lua/syntax/ast';
import type { LuaSemanticFrontendFile } from '../../../lua/semantic/frontend';
import type { Decl } from '../../../lua/semantic/model';

export type StaticStorageDeclaration =
	| { kind: 'struct'; statement: LuaStructDeclarationStatement }
	| { kind: 'bss'; declaration: Decl; statement: LuaBssDeclarationStatement }
	| { kind: 'data'; declaration: Decl; statement: LuaDataDeclarationStatement }
	| { kind: 'rodata'; declaration: Decl; statement: LuaRodataDeclarationStatement };

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
			case LuaSyntaxKind.DataDeclarationStatement: {
				const dataStatement = statement as LuaDataDeclarationStatement;
				declarations.push({
					kind: 'data',
					declaration: semantics.getDeclaration(dataStatement.name.range),
					statement: dataStatement,
				});
				break;
			}
			case LuaSyntaxKind.RodataDeclarationStatement: {
				const rodataStatement = statement as LuaRodataDeclarationStatement;
				declarations.push({
					kind: 'rodata',
					declaration: semantics.getDeclaration(rodataStatement.name.range),
					statement: rodataStatement,
				});
				break;
			}
		}
	}
	return declarations;
};
