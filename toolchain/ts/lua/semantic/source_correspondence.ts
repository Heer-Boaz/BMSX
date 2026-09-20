import { parseLuaChunk } from '../analysis/parse';
import { matchLuaTokens } from '../analysis/token_match';
import type { SourcePosition, SourceRange } from '../source_range';
import { LuaSyntaxKind, type LuaFunctionExpression } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import { isLuaTrivia } from '../syntax/token';
import type { LuaTokenSequence } from '../syntax/token_sequence';
import { buildLuaFileSemanticData, type FileSemanticData } from './model';
import type { ScopeID } from './scope_facts';
import { compareSourcePosition, sourcePositionKey, sourceRangeKey } from './source_range';

class FileCorrespondence {
	private readonly oldFile: FileSemanticData;
	private readonly newFile: FileSemanticData;
	private readonly oldTokens: LuaTokenSequence;
	private readonly newTokens: LuaTokenSequence;
	private readonly tokens: Int32Array;
	private readonly scopes = new Map<ScopeID, ScopeID>();
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
		const newScopes = new Map<string, ScopeID>();
		for (let index = 1; index < this.newFile.scopes.length; index += 1) {
			const scope = this.newFile.scopes[index];
			const start = scope.startInclusive;
			newScopes.set(sourcePositionKey(this.newFile.chunk.locations.position(start.unit, start.offset)), scope.id);
		}
		// Independent roots correspond by module ownership, not by occurrence identity.
		this.scopes.set(this.oldFile.scopes[0].id, this.newFile.scopes[0].id);
		for (let index = 1; index < this.oldFile.scopes.length; index += 1) {
			const scope = this.oldFile.scopes[index];
			const start = this.oldFile.chunk.locations.position(scope.startInclusive.unit, scope.startInclusive.offset);
			const opening = this.tokenAt({ line: start.line, column: start.column - 1 });
			const targetToken = opening < 0 ? -1 : this.tokens[opening];
			if (targetToken < 0) {
				continue;
			}
			const token = this.newTokens.getSignificant(targetToken);
			const end = this.newFile.chunk.locations.range(token).end;
			const target = newScopes.get(`${end.line}:${end.column + 1}`);
			if (target !== undefined
				&& this.newFile.scopeParents.get(target) === this.scopes.get(this.oldFile.scopeParents.get(scope.id)!)) {
				this.scopes.set(scope.id, target);
			}
		}
		for (let index = 0; index < this.oldFile.decls.length; index += 1) {
			const span = this.oldFile.decls[index].span;
			const locations = this.oldFile.chunk.locations;
			this.oldDeclarations.set(`${locations.offset(span.unit, span.start)}:${locations.offset(span.unit, span.end)}`, index);
		}
		for (let index = 0; index < this.newFile.decls.length; index += 1) {
			const span = this.newFile.decls[index].span;
			const locations = this.newFile.chunk.locations;
			this.newDeclarations.set(`${locations.offset(span.unit, span.start)}:${locations.offset(span.unit, span.end)}`, index);
		}
		const oldFunctions = new Map<string, LuaFunctionExpression>();
		const newFunctions = new Map<string, LuaFunctionExpression>();
		walkLuaAst(this.oldFile.chunk, node => {
			if (node.kind === LuaSyntaxKind.FunctionExpression) oldFunctions.set(sourceRangeKey(this.oldFile.chunk.locations.range(node.span)), node);
		});
		walkLuaAst(this.newFile.chunk, node => {
			if (node.kind === LuaSyntaxKind.FunctionExpression) newFunctions.set(sourceRangeKey(this.newFile.chunk.locations.range(node.span)), node);
		});
		const oldScopes = new Map<string, ScopeID>();
		for (let index = 1; index < this.oldFile.scopes.length; index += 1) {
			const scope = this.oldFile.scopes[index];
			const start = scope.startInclusive;
			oldScopes.set(sourcePositionKey(this.oldFile.chunk.locations.position(start.unit, start.offset)), scope.id);
		}
		for (const oldFunction of oldFunctions.values()) {
			const mapped = this.mapRange(this.oldFile.chunk.locations.range(oldFunction.span), true);
			if (mapped === undefined) continue;
			const newFunction = newFunctions.get(sourceRangeKey(mapped));
			if (newFunction === undefined) continue;
			const oldScope = oldScopes.get(sourcePositionKey(this.oldFile.chunk.locations.position(oldFunction.body.span.unit, oldFunction.body.startInclusive)))!;
			const newScope = newScopes.get(sourcePositionKey(this.newFile.chunk.locations.position(newFunction.body.span.unit, newFunction.body.startInclusive)))!;
			if (this.scopes.get(oldScope) !== newScope) continue;
			this.forwardFunctions.set(sourceRangeKey(this.oldFile.chunk.locations.range(oldFunction.span)), this.newFile.chunk.locations.range(newFunction.span));
			this.backwardFunctions.set(sourceRangeKey(this.newFile.chunk.locations.range(newFunction.span)), this.oldFile.chunk.locations.range(oldFunction.span));
		}
	}

	private tokenAt(position: SourcePosition): number {
		const locations = this.oldFile.chunk.locations;
		const cursor = this.oldTokens.cursor();
		cursor.seekOffset(locations.offsetAt(position));
		const token = cursor.token;
		if (token === undefined || isLuaTrivia(token.type)) return -1;
		const range = locations.range(token);
		return compareSourcePosition(range.start.line, range.start.column, position.line, position.column) <= 0
			&& compareSourcePosition(position.line, position.column, range.end.line, range.end.column) <= 0
			? cursor.significantIndex : -1;
	}

	private mapRange(range: SourceRange, enclosing: boolean): SourceRange | undefined {
		const start = this.tokenAt(range.start);
		const end = this.tokenAt(range.end);
		if (start < 0 || end < 0 || this.tokens[start] < 0) return undefined;
		let targetEnd = this.tokens[end];
		if (!enclosing) {
			// Compare the exact syntax span from its matched opening. Global LCS
			// ties may assign its closing ')' to a later inserted statement.
			targetEnd = this.tokens[start] + end - start;
			if (targetEnd >= this.newTokens.significantCount) return undefined;
			for (let index = start; index <= end; index += 1) {
				const oldToken = this.oldTokens.getSignificant(index);
				const newToken = this.newTokens.getSignificant(this.tokens[start] + index - start);
				if (oldToken.type !== newToken.type || oldToken.lexeme !== newToken.lexeme) return undefined;
			}
		}
		if (targetEnd < 0) return undefined;
		const startToken = this.newFile.chunk.locations.range(this.newTokens.getSignificant(this.tokens[start])).start;
		const endToken = this.newFile.chunk.locations.range(this.newTokens.getSignificant(targetEnd)).start;
		const oldStart = this.oldFile.chunk.locations.range(this.oldTokens.getSignificant(start)).start;
		const oldEnd = this.oldFile.chunk.locations.range(this.oldTokens.getSignificant(end)).start;
		return {
			path: range.path,
			start: {
				line: startToken.line + range.start.line - oldStart.line,
				column: range.start.line === oldStart.line
					? startToken.column + range.start.column - oldStart.column : range.start.column,
			},
			end: {
				line: endToken.line + range.end.line - oldEnd.line,
				column: range.end.line === oldEnd.line
					? endToken.column + range.end.column - oldEnd.column : range.end.column,
			},
		};
	}

	public unchangedRange(range: SourceRange): SourceRange | undefined { return this.mapRange(range, false); }

	public declaration(range: SourceRange): SourceRange | undefined {
		const oldLocations = this.oldFile.chunk.locations;
		const oldIndex = this.oldDeclarations.get(`${oldLocations.offsetAt(range.start)}:${oldLocations.offsetAt(range.end)}`);
		if (oldIndex === undefined) return undefined;
		const mapped = this.mapRange(range, false);
		if (mapped === undefined) return undefined;
		const newLocations = this.newFile.chunk.locations;
		const newIndex = this.newDeclarations.get(`${newLocations.offsetAt(mapped.start)}:${newLocations.offsetAt(mapped.end)}`);
		if (newIndex === undefined) return undefined;
		const oldDecl = this.oldFile.decls[oldIndex];
		const newDecl = this.newFile.decls[newIndex];
		return this.scopes.get(oldDecl.scope) === newDecl.scope ? this.newFile.chunk.locations.range(newDecl.span) : undefined;
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

	/** Exact token spans, including zero-width generated source locations. */
	public unchangedRange(range: SourceRange): SourceRange | undefined {
		if (!this.previous.has(range.path) || !this.current.has(range.path)) return undefined;
		return this.previous.get(range.path) === this.current.get(range.path) ? range : this.file(range.path).unchangedRange(range);
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
