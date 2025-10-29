import type { LuaSourceRange } from '../../lua/ast.ts';
import type { ConsoleResourceDescriptor } from '../types';
import type { CodeTabContext, SearchMatch } from './types';
import type { LuaSemanticWorkspace } from './semantic_workspace.ts';
import { planRenameLineEdits } from './rename_apply';

export type CrossFileRenameDependencies = {
	normalizeChunkReference(reference: string | null): string | null;
	findResourceDescriptorForChunk(chunkPath: string): ConsoleResourceDescriptor;
	createLuaCodeTabContext(descriptor: ConsoleResourceDescriptor): CodeTabContext;
	createEntryTabContext(): CodeTabContext | null;
	getEntryTabId(): string | null;
	setEntryTabId(id: string | null): void;
	getPrimaryAssetId(): string | null;
	getCodeTabContext(id: string): CodeTabContext | null;
	setCodeTabContext(context: CodeTabContext): void;
	listCodeTabContexts(): Iterable<CodeTabContext>;
	splitLines(source: string): string[];
	setTabDirty(tabId: string, dirty: boolean): void;
};

export class CrossFileRenameManager {
	public constructor(
		private readonly deps: CrossFileRenameDependencies,
		private readonly workspace: LuaSemanticWorkspace,
	) {}

	public applyRenameToChunk(chunkName: string, ranges: readonly LuaSourceRange[], newName: string, activeChunkName: string | null): number {
		const normalizedActive = activeChunkName ? this.deps.normalizeChunkReference(activeChunkName) ?? activeChunkName : null;
		const context = this.ensureCodeTabContextForChunk(chunkName);
		if (!context) {
			return 0;
		}
		const normalizedChunk = this.deps.normalizeChunkReference(chunkName) ?? chunkName;
		if (normalizedActive && normalizedChunk === normalizedActive) {
			return 0;
		}
		const lines = this.getContextLinesForRename(context);
		const matches: SearchMatch[] = [];
		for (let index = 0; index < ranges.length; index += 1) {
			const match = convertRangeToSearchMatch(ranges[index], lines);
			if (match) {
				matches.push(match);
			}
		}
		if (matches.length === 0) {
			return 0;
		}
		matches.sort((a, b) => {
			if (a.row !== b.row) {
				return a.row - b.row;
			}
			return a.start - b.start;
		});
		const edits = planRenameLineEdits(lines, matches, newName);
		if (edits.length === 0) {
			return 0;
		}
		for (let index = 0; index < edits.length; index += 1) {
			const edit = edits[index];
			lines[edit.row] = edit.text;
		}
		this.applyLinesToContextSnapshot(context, lines);
		this.workspace.updateFile(chunkName, lines.join('\n'));
		return matches.length;
	}

	private getContextLinesForRename(context: CodeTabContext): string[] {
		if (context.snapshot) {
			return context.snapshot.lines.slice();
		}
		const source = context.load();
		context.lastSavedSource = source;
		return this.deps.splitLines(source);
	}

	private applyLinesToContextSnapshot(context: CodeTabContext, lines: readonly string[]): void {
		const snapshot = context.snapshot ?? {
			lines: [],
			cursorRow: 0,
			cursorColumn: 0,
			scrollRow: 0,
			scrollColumn: 0,
			selectionAnchor: null,
			dirty: true,
		};
		snapshot.lines = lines.slice();
		snapshot.dirty = true;
		if (snapshot.cursorRow >= snapshot.lines.length) {
			snapshot.cursorRow = Math.max(0, snapshot.lines.length - 1);
			snapshot.cursorColumn = 0;
		}
		const cursorLine = snapshot.lines[snapshot.cursorRow] ?? '';
		snapshot.cursorColumn = clamp(snapshot.cursorColumn, 0, cursorLine.length);
		snapshot.scrollRow = clamp(snapshot.scrollRow, 0, Math.max(0, snapshot.lines.length - 1));
		context.snapshot = snapshot;
		context.dirty = true;
		this.deps.setTabDirty(context.id, context.dirty);
	}

	private ensureCodeTabContextForChunk(chunkName: string): CodeTabContext | null {
		const existing = this.findCodeTabContextForChunk(chunkName);
		if (existing) {
			return existing;
		}
		const normalized = this.deps.normalizeChunkReference(chunkName) ?? chunkName;
		try {
			const descriptor = this.deps.findResourceDescriptorForChunk(normalized);
			const contextId: string = `lua:${descriptor.assetId}`;
			let context = this.deps.getCodeTabContext(contextId) ?? null;
			if (!context) {
				context = this.deps.createLuaCodeTabContext(descriptor);
				this.deps.setCodeTabContext(context);
			}
			return context;
		} catch {
			const entryAliases: string[] = [];
			const primary = this.deps.getPrimaryAssetId();
			if (primary) {
				entryAliases.push(primary);
			}
			entryAliases.push('__entry__', '<console>');
			const normalizedChunk = this.deps.normalizeChunkReference(chunkName) ?? chunkName;
			const isEntryChunk = entryAliases.some(alias => alias === chunkName || alias === normalizedChunk);
			if (!isEntryChunk) {
				return null;
			}
			const entryId = this.deps.getEntryTabId();
			if (entryId) {
				const entryContext = this.deps.getCodeTabContext(entryId);
				if (entryContext) {
					return entryContext;
				}
			}
			const entryContext = this.deps.createEntryTabContext();
			if (entryContext) {
				this.deps.setEntryTabId(entryContext.id);
				this.deps.setCodeTabContext(entryContext);
				return entryContext;
			}
			return null;
		}
	}

	private findCodeTabContextForChunk(chunkName: string): CodeTabContext | null {
		const normalized = this.deps.normalizeChunkReference(chunkName) ?? chunkName;
		for (const context of this.deps.listCodeTabContexts()) {
			const descriptor = context.descriptor;
			if (descriptor) {
				const descriptorPath = this.deps.normalizeChunkReference(descriptor.path);
				if ((descriptorPath && descriptorPath === normalized)
					|| descriptor.assetId === chunkName
					|| descriptor.assetId === normalized) {
					return context;
				}
			} else {
				const entryAliases: string[] = [];
				const primary = this.deps.getPrimaryAssetId();
				if (primary) {
					entryAliases.push(primary);
				}
				entryAliases.push('__entry__', '<console>');
				for (let index = 0; index < entryAliases.length; index += 1) {
					const alias = entryAliases[index];
					if (alias === chunkName || alias === normalized) {
						return context;
					}
				}
			}
		}
		return null;
	}
}

export function convertRangeToSearchMatch(range: LuaSourceRange | null | undefined, lines: readonly string[]): SearchMatch | null {
	if (!range) {
		return null;
	}
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= lines.length) {
		return null;
	}
	const line = lines[rowIndex] ?? '';
	const startColumn = Math.max(0, range.start.column - 1);
	const endInclusive = Math.max(startColumn, range.end.column - 1);
	const endExclusive = Math.min(line.length, endInclusive + 1);
	if (endExclusive <= startColumn) {
		return null;
	}
	return { row: rowIndex, start: startColumn, end: endExclusive };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
