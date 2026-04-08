import type { CodeTabContext, SearchMatch } from '../../types';
import type { ReferenceMatchInfo } from '../references/reference_state';
import type { LuaSourceRange } from '../../../../lua/syntax/lua_ast';
import { clamp } from '../../../../utils/clamp';
import { createLuaCodeTabContext, findCodeTabContext, getActiveCodeTabContext } from '../../browser/editor_tabs';
import { findResourceDescriptorForChunk } from '../resources/resource_lookup';
import { getTextSnapshot, splitText } from '../../text/source_text';
import { syncSemanticWorkspacePath, getOrCreateSemanticWorkspace } from '../../semantic_workspace_sync';
import { ide_state } from '../../ide_state';
import { markTextMutated } from '../../text_utils';
import { markDiagnosticsDirtyForChunk } from '../problems/diagnostics_controller';
import { prepareUndo, applyUndoableReplace, recordEditContext } from '../../undo_controller';
import { setSingleCursorSelectionAnchor } from '../../cursor_state';
import { updateDesiredColumn, ensureCursorVisible } from '../../browser/caret';
import { resetBlink } from '../../render/render_caret';

export type RenameCommitPayload = {
	matches: readonly SearchMatch[];
	newName: string;
	activeIndex: number;
	originalName: string;
	info: ReferenceMatchInfo;
};

export type RenameCommitResult = {
	updatedMatches: number;
};

export type RenameLineEdit = {
	row: number;
	text: string;
};

export function commitRename(payload: RenameCommitPayload): RenameCommitResult {
	const { matches, newName, activeIndex, info } = payload;
	const activeContext = getActiveCodeTabContext();
	const activePath = activeContext.descriptor.path;
	const workspace = getOrCreateSemanticWorkspace();
	const sortedMatches = matches.slice();
	sortedMatches.sort((a, b) => a.row !== b.row ? a.row - b.row : a.start - b.start);
	let updatedTotal = 0;

	const snapshot = workspace.getSnapshot();
	const decl = info.definitionKey ? snapshot.getDecl(info.definitionKey) : null;
	const references = info.definitionKey ? snapshot.getReferences(info.definitionKey) : [];
	type RangeBucket = { path: string; ranges: LuaSourceRange[]; seen: Set<string> };
	const rangeMap = new Map<string, RangeBucket>();
	const addRange = (range: LuaSourceRange): void => {
		const path = range.path ?? activePath;
		let bucket = rangeMap.get(path);
		if (!bucket) {
			bucket = { path, ranges: [], seen: new Set<string>() };
			rangeMap.set(path, bucket);
		}
		const key = `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
		if (bucket.seen.has(key)) {
			return;
		}
		bucket.seen.add(key);
		bucket.ranges.push(range);
	};
	if (decl) {
		addRange(decl.range);
	}
	for (let index = 0; index < references.length; index += 1) {
		addRange(references[index].range);
	}
	rangeMap.delete(activePath);

	if (sortedMatches.length > 0) {
		prepareUndo('rename', false);
		recordEditContext('replace', newName);
		for (let index = sortedMatches.length - 1; index >= 0; index -= 1) {
			const match = sortedMatches[index];
			const startOffset = ide_state.buffer.offsetAt(match.row, match.start);
			const endOffset = ide_state.buffer.offsetAt(match.row, match.end);
			applyUndoableReplace(startOffset, endOffset - startOffset, newName);
			ide_state.layout.invalidateLine(match.row);
		}
		markTextMutated();

		const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
		const focused = sortedMatches[clampedIndex];
		ide_state.cursorRow = focused.row;
		ide_state.cursorColumn = focused.start;
		setSingleCursorSelectionAnchor(ide_state, focused.row, focused.start + newName.length);
		updateDesiredColumn();
		resetBlink();
		ide_state.cursorRevealSuspended = false;
		ensureCursorVisible();
		updatedTotal += sortedMatches.length;
	}

	for (const bucket of rangeMap.values()) {
		const replacements = crossFileRenameManager.applyRenameToChunk(bucket.path, bucket.ranges, newName, activePath);
		updatedTotal += replacements;
		if (replacements > 0) {
			markDiagnosticsDirtyForChunk(bucket.path);
		}
	}
	return { updatedMatches: updatedTotal };
}

export function planRenameLineEdits(lines: readonly string[], matches: readonly SearchMatch[], newName: string): RenameLineEdit[] {
	if (matches.length === 0) {
		return [];
	}
	const edits: RenameLineEdit[] = [];
	let currentRow = matches[0].row;
	let source = lines[currentRow] ?? '';
	let builder = '';
	let sliceStart = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row !== currentRow) {
			builder += source.slice(sliceStart);
			if (builder !== source) {
				edits.push({ row: currentRow, text: builder });
			}
			currentRow = match.row;
			source = lines[currentRow] ?? '';
			builder = '';
			sliceStart = 0;
		}
		builder += source.slice(sliceStart, match.start);
		builder += newName;
		sliceStart = match.end;
	}
	builder += source.slice(sliceStart);
	if (builder !== source) {
		edits.push({ row: currentRow, text: builder });
	}
	return edits;
}

export class CrossFileRenameManager {
	public constructor() {}

	public applyRenameToChunk(path: string, ranges: readonly LuaSourceRange[], newName: string, activePath: string): number {
		const context = this.ensureCodeTabContextForChunk(path);
		if (path === activePath) {
			return 0;
		}
		if (context.readOnly === true) {
			return 0;
		}
		const lines = this.getContextLinesForRename(context);
		const matches: SearchMatch[] = [];
		for (let index = 0; index < ranges.length; index += 1) {
			matches.push(convertRangeToSearchMatch(ranges[index]));
		}
		if (matches.length === 0) {
			return 0;
		}
		matches.sort((a, b) => a.row !== b.row ? a.row - b.row : a.start - b.start);
		const edits = planRenameLineEdits(lines, matches, newName);
		if (edits.length === 0) {
			return 0;
		}
		for (let index = 0; index < edits.length; index += 1) {
			const edit = edits[index];
			lines[edit.row] = edit.text;
		}
		this.applyLinesToContextSnapshot(context, lines);
		const workspace = getOrCreateSemanticWorkspace();
		syncSemanticWorkspacePath({
			path,
			source: lines.join('\n'),
			lines,
			version: context.textVersion,
		}, workspace);
		return matches.length;
	}

	private getContextLinesForRename(context: CodeTabContext): string[] {
		return splitText(getTextSnapshot(context.buffer));
	}

	private applyLinesToContextSnapshot(context: CodeTabContext, lines: readonly string[]): void {
		const source = lines.join('\n');
		context.buffer.replace(0, context.buffer.length, source);
		context.textVersion = context.buffer.version;
		context.dirty = true;
		context.savePointDepth = -1;
		const lineCount = context.buffer.getLineCount();
		if (context.cursorRow >= lineCount) {
			context.cursorRow = lineCount - 1;
			context.cursorColumn = 0;
		}
		const cursorLength = context.buffer.getLineEndOffset(context.cursorRow) - context.buffer.getLineStartOffset(context.cursorRow);
		context.cursorColumn = clamp(context.cursorColumn, 0, cursorLength);
		context.scrollRow = clamp(context.scrollRow, 0, lineCount - 1);
		this.markContextTabDirty(context.id, context.dirty);
	}

	private ensureCodeTabContextForChunk(path: string): CodeTabContext {
		const existing = findCodeTabContext(path);
		if (existing) {
			return existing;
		}
		const descriptor = findResourceDescriptorForChunk(path)!;
		let context = findCodeTabContext(descriptor.path);
		if (!context) {
			context = createLuaCodeTabContext(descriptor);
			ide_state.codeTabContexts.set(context.id, context);
			this.markContextTabDirty(context.id, context.dirty);
		}
		return context;
	}

	private markContextTabDirty(contextId: string, dirty: boolean): void {
		const tab = ide_state.tabs.find(candidate => candidate.id === contextId);
		if (!tab) {
			return;
		}
		tab.dirty = dirty;
	}
}

export const crossFileRenameManager = new CrossFileRenameManager();

export function convertRangeToSearchMatch(range: LuaSourceRange): SearchMatch {
	const row = range.start.line - 1;
	const start = range.start.column - 1;
	const end = range.end.column;
	return { row, start, end };
}
