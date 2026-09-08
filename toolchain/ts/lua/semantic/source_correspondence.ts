import { parseLuaChunk } from '../analysis/parse';
import { matchLuaTokens } from '../analysis/token_match';
import type { SourcePosition, SourceRange } from '../source_range';
import { LuaSyntaxKind, type LuaFunctionExpression } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import type { LuaToken } from '../syntax/token';
import { buildLuaFileSemanticData, type FileSemanticData } from './model';
import { compareSourcePosition, sourcePositionKey, sourceRangeKey } from './source_range';

class FileCorrespondence {
	private readonly oldFile: FileSemanticData;
	private readonly newFile: FileSemanticData;
	private readonly oldTokens: readonly LuaToken[];
	private readonly newTokens: readonly LuaToken[];
	private readonly tokens: Int32Array;
	private readonly scopes: Int32Array;
	private readonly oldDeclarations = new Map<string, number>();
	private readonly newDeclarations = new Map<string, number>();
	private readonly forwardFunctions = new Map<string, SourceRange>();
	private readonly backwardFunctions = new Map<string, SourceRange>();

	constructor(path: string, previous: string, current: string) {
		const oldParsed = parseLuaChunk(previous, path);
		const newParsed = parseLuaChunk(current, path);
		this.oldFile = buildLuaFileSemanticData(previous, path, oldParsed);
		this.newFile = buildLuaFileSemanticData(current, path, newParsed);
		this.oldTokens = oldParsed.tokens;
		this.newTokens = newParsed.tokens;
		this.tokens = matchLuaTokens(this.oldTokens, this.newTokens);
		const newScopes = new Map<string, number>();
		for (let index = 1; index < this.newFile.scopes.length; index += 1) {
			newScopes.set(sourcePositionKey(this.newFile.scopes[index].startInclusive), index);
		}
		this.scopes = new Int32Array(this.oldFile.scopes.length).fill(-1);
		this.scopes[0] = 0; // The same module is the root of both lexical trees.
		for (let index = 1; index < this.oldFile.scopes.length; index += 1) {
			const scope = this.oldFile.scopes[index];
			const opening = this.tokenAt({ line: scope.startInclusive.line, column: scope.startInclusive.column - 1 });
			const targetToken = opening < 0 ? -1 : this.tokens[opening];
			if (targetToken < 0) {
				continue;
			}
			const token = this.newTokens[targetToken];
			const target = newScopes.get(`${token.endLine}:${token.endColumn + 1}`);
			if (target !== undefined && this.newFile.scopes[target].parentIndex === this.scopes[scope.parentIndex]) {
				this.scopes[index] = target;
			}
		}
		for (let index = 0; index < this.oldFile.decls.length; index += 1) {
			this.oldDeclarations.set(sourceRangeKey(this.oldFile.decls[index].range), index);
		}
		for (let index = 0; index < this.newFile.decls.length; index += 1) {
			this.newDeclarations.set(sourceRangeKey(this.newFile.decls[index].range), index);
		}
		const oldFunctions = new Map<string, LuaFunctionExpression>();
		const newFunctions = new Map<string, LuaFunctionExpression>();
		walkLuaAst(this.oldFile.chunk, node => {
			if (node.kind === LuaSyntaxKind.FunctionExpression) oldFunctions.set(sourceRangeKey(node.range), node);
		});
		walkLuaAst(this.newFile.chunk, node => {
			if (node.kind === LuaSyntaxKind.FunctionExpression) newFunctions.set(sourceRangeKey(node.range), node);
		});
		const oldScopes = new Map<string, number>();
		for (let index = 1; index < this.oldFile.scopes.length; index += 1) {
			oldScopes.set(sourcePositionKey(this.oldFile.scopes[index].startInclusive), index);
		}
		for (const oldFunction of oldFunctions.values()) {
			const mapped = this.mapRange(oldFunction.range, true);
			if (mapped === undefined) continue;
			const newFunction = newFunctions.get(sourceRangeKey(mapped));
			if (newFunction === undefined) continue;
			const oldScope = oldScopes.get(sourcePositionKey(oldFunction.body.startInclusive))!;
			const newScope = newScopes.get(sourcePositionKey(newFunction.body.startInclusive))!;
			if (this.scopes[oldScope] !== newScope) continue;
			this.forwardFunctions.set(sourceRangeKey(oldFunction.range), newFunction.range);
			this.backwardFunctions.set(sourceRangeKey(newFunction.range), oldFunction.range);
		}
	}

	private tokenAt(position: SourcePosition): number {
		let low = 0;
		let high = this.oldTokens.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			const token = this.oldTokens[middle];
			if (compareSourcePosition(token.line, token.column, position.line, position.column) <= 0) low = middle + 1;
			else high = middle;
		}
		const index = low - 1;
		if (index < 0) return -1;
		const token = this.oldTokens[index];
		return compareSourcePosition(position.line, position.column, token.endLine, token.endColumn) <= 0 ? index : -1;
	}

	private mapRange(range: SourceRange, enclosing: boolean): SourceRange | undefined {
		const start = this.tokenAt(range.start);
		const end = this.tokenAt(range.end);
		if (start < 0 || end < 0 || this.tokens[start] < 0 || this.tokens[end] < 0) return undefined;
		if (!enclosing) {
			for (let index = start; index <= end; index += 1) {
				if (this.tokens[index] !== this.tokens[start] + index - start) return undefined;
			}
		}
		const startToken = this.newTokens[this.tokens[start]];
		const endToken = this.newTokens[this.tokens[end]];
		return {
			path: range.path,
			start: { line: startToken.line, column: startToken.column },
			end: { line: endToken.endLine, column: endToken.endColumn },
		};
	}

	public declaration(range: SourceRange): SourceRange | undefined {
		const oldIndex = this.oldDeclarations.get(sourceRangeKey(range));
		if (oldIndex === undefined) return undefined;
		const mapped = this.mapRange(range, false);
		if (mapped === undefined) return undefined;
		const newIndex = this.newDeclarations.get(sourceRangeKey(mapped));
		if (newIndex === undefined) return undefined;
		const oldDecl = this.oldFile.decls[oldIndex];
		const newDecl = this.newFile.decls[newIndex];
		return this.scopes[oldDecl.scopeIndex] === newDecl.scopeIndex ? newDecl.range : undefined;
	}

	public functionRange(range: SourceRange): SourceRange | undefined {
		return this.forwardFunctions.get(sourceRangeKey(range));
	}

	public previousFunctionRange(range: SourceRange): SourceRange | undefined {
		return this.backwardFunctions.get(sourceRangeKey(range));
	}
}

/** Build-scoped source matching, shared by capture allocation and revision proof. */
export class LuaSourceCorrespondence {
	private readonly files = new Map<string, FileCorrespondence>();

	constructor(
		private readonly previous: ReadonlyMap<string, string>,
		private readonly current: ReadonlyMap<string, string>,
	) {}

	/** A generated module's final link values replace its provisional source. */
	public invalidate(path: string): void { this.files.delete(path); }

	private file(path: string): FileCorrespondence {
		let match = this.files.get(path);
		if (match === undefined) {
			match = new FileCorrespondence(path, this.previous.get(path)!, this.current.get(path)!);
			this.files.set(path, match);
		}
		return match;
	}

	public declaration(range: SourceRange): SourceRange | undefined {
		if (!this.previous.has(range.path) || !this.current.has(range.path)) return undefined;
		return this.previous.get(range.path) === this.current.get(range.path) ? range : this.file(range.path).declaration(range);
	}

	public functionRange(range: SourceRange): SourceRange | undefined {
		if (!this.previous.has(range.path) || !this.current.has(range.path)) return undefined;
		return this.previous.get(range.path) === this.current.get(range.path) ? range : this.file(range.path).functionRange(range);
	}

	public previousFunctionRange(range: SourceRange): SourceRange | undefined {
		if (!this.previous.has(range.path) || !this.current.has(range.path)) return undefined;
		return this.previous.get(range.path) === this.current.get(range.path) ? range : this.file(range.path).previousFunctionRange(range);
	}
}
