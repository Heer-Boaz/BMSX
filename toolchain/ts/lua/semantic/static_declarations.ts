import type { HashLookup } from '../../collections/hash_map';
import { LuaSyntaxKind, type LuaBssDeclarationStatement, type LuaDataDeclarationStatement, type LuaRodataDeclarationStatement, type LuaStructDeclarationStatement } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import type { LuaSyntaxSpan } from '../syntax/source_locations';
import type { Decl, FileSemanticData, SymbolID } from './model';
import type { ScopeID } from './scope_facts';
import { findInnermostScopeAtOffset } from './scope_query';

export type LuaStorageDeclaration = LuaBssDeclarationStatement | LuaDataDeclarationStatement | LuaRodataDeclarationStatement;
export type LuaStaticDeclaration = Decl & { kind: 'type' | 'bss' | 'data' | 'rodata' };

export function isLuaStaticDeclaration(declaration: Decl): declaration is LuaStaticDeclaration {
	return declaration.kind === 'type' || declaration.kind === 'bss' || declaration.kind === 'data' || declaration.kind === 'rodata';
}

type StaticFileDeclarations = {
	readonly structs: ReadonlyMap<SymbolID, LuaStructDeclarationStatement>;
	readonly storage: ReadonlyMap<SymbolID, LuaStorageDeclaration>;
	readonly typesByScope: ReadonlyMap<ScopeID, ReadonlyMap<string, Decl>>;
};

/** Static declaration syntax belongs to an immutable bind, not a codegen frame. */
export class LuaStaticDeclarations {
	public readonly valueGlobals: readonly LuaStaticDeclaration[];
	private readonly files = new Map<string, FileSemanticData>();
	private readonly globals = new Map<string, Decl>();
	private readonly indices = new Map<FileSemanticData, StaticFileDeclarations>();

	public constructor(files: readonly FileSemanticData[], private readonly declarations: HashLookup<SymbolID, Decl>,
		globals: ReadonlyMap<string, SymbolID>) {
		const valueGlobals: LuaStaticDeclaration[] = [];
		for (const id of globals.values()) {
			const declaration = declarations.get(id);
			if (isLuaStaticDeclaration(declaration)) {
				valueGlobals.push(declaration);
			}
		}
		this.valueGlobals = valueGlobals;
		for (const file of files) {
			this.files.set(file.file, file);
			for (const declaration of file.globalDecls) {
				if (declaration.kind === 'type' && !this.globals.has(declaration.name)) {
					this.globals.set(declaration.name, declaration);
				}
			}
		}
	}

	/** Type syntax has block-wide forward visibility; value syntax stays ordered Lua. */
	public typeAt(file: FileSemanticData, name: string, span: LuaSyntaxSpan): Decl | undefined {
		const types = this.index(file).typesByScope;
		let scope = findInnermostScopeAtOffset(file, file.chunk.locations.offset(span.unit, span.start));
		while (scope !== undefined) {
			const declaration = types.get(scope.id)?.get(name);
			if (declaration !== undefined) return declaration;
			const parent = file.scopeParents.get(scope.id);
			scope = parent === undefined ? undefined : file.scopesById.get(parent)!;
		}
		return this.globals.get(name);
	}

	public struct(declaration: Decl): LuaStructDeclarationStatement {
		return this.index(this.files.get(declaration.file)!).structs.get(declaration.id)!;
	}

	public storage(declaration: Decl): LuaStorageDeclaration {
		return this.index(this.files.get(declaration.file)!).storage.get(declaration.id)!;
	}

	private index(file: FileSemanticData): StaticFileDeclarations {
		const retained = this.indices.get(file);
		if (retained !== undefined) return retained;
		const structs = new Map<SymbolID, LuaStructDeclarationStatement>();
		const storage = new Map<SymbolID, LuaStorageDeclaration>();
		const typesByScope = new Map<ScopeID, Map<string, Decl>>();
		walkLuaAst(file.chunk, node => {
			switch (node.kind) {
				case LuaSyntaxKind.StructDeclarationStatement: {
					const id = file.declarationIdsBySyntax.get(node.name)!;
					const declaration = this.declarations.get(id);
					structs.set(id, node);
					let scope = typesByScope.get(declaration.scope);
					if (scope === undefined) {
						scope = new Map();
						typesByScope.set(declaration.scope, scope);
					}
					scope.set(declaration.name, declaration);
					break;
				}
				case LuaSyntaxKind.BssDeclarationStatement:
				case LuaSyntaxKind.DataDeclarationStatement:
				case LuaSyntaxKind.RodataDeclarationStatement:
					storage.set(file.declarationIdsBySyntax.get(node.name)!, node);
					break;
			}
		});
		const result = { structs, storage, typesByScope };
		this.indices.set(file, result);
		return result;
	}
}
