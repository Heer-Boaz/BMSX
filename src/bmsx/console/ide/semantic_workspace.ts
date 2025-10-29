import { LuaProjectIndex, type LuaSemanticModel, type Decl, type Ref, type FileSemanticData, type SymbolID } from './semantic_model.ts';

export class LuaSemanticWorkspace {
	private readonly index = new LuaProjectIndex();

	public updateFile(file: string, source: string): LuaSemanticModel {
		return this.index.updateFile(file, source);
	}

	public removeFile(file: string): void {
		this.index.removeFile(file);
	}

	public getModel(file: string): LuaSemanticModel | null {
		return this.index.getFileModel(file);
	}

	public getDefinitionAt(file: string, row: number, column: number): Decl | null {
		return this.index.getDefinitionAt(file, { line: row, column });
	}

	public symbolAt(file: string, row: number, column: number): { id: SymbolID; decl: Decl } | null {
		return this.index.symbolAt(file, { line: row, column });
	}

	public findReferencesByPosition(file: string, row: number, column: number): { id: SymbolID; decl: Decl; references: readonly Ref[] } | null {
		const symbol = this.symbolAt(file, row, column);
		if (!symbol) {
			return null;
		}
		const references = this.index.getReferences(symbol.id);
		return { id: symbol.id, decl: symbol.decl, references };
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		return this.index.getReferences(symbolId);
	}

	public getDecl(symbolId: SymbolID): Decl | null {
		return this.index.getDecl(symbolId);
	}

	public getFileData(file: string): FileSemanticData | null {
		return this.index.getFileData(file);
	}

	public getProjectIndex(): LuaProjectIndex {
		return this.index;
	}

	public listFiles(): string[] {
		return this.index.listFiles();
	}
}
