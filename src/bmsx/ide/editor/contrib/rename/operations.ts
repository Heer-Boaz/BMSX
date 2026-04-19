import type { CodeTabContext, SearchMatch } from '../../../common/models';
import type { ReferenceMatchInfo } from '../references/state';
import type { LuaSourceRange } from '../../../../lua/syntax/ast';
import { clamp } from '../../../../common/clamp';
import { createLuaCodeTabContext, findCodeTabContext, getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { findResourceDescriptorForChunk } from '../../../workbench/contrib/resources/lookup';
import { copyLinesSnapshot, textFromLines } from '../../text/source_text';
import { syncSemanticWorkspacePath, getOrCreateSemanticWorkspace } from '../intellisense/semantic_workspace_sync';
import { markTextMutated } from '../../common/text_runtime';
import { markDiagnosticsDirtyForChunk } from '../diagnostics/controller';
import { prepareUndo, applyUndoableReplace, recordEditContext } from '../../editing/undo_controller';
import { setSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { updateDesiredColumn, ensureCursorVisible } from '../../ui/view/caret/caret';
import { resetBlink } from '../../render/caret';
import { editorCaretState } from '../../ui/view/caret/state';
import { editorDocumentState } from '../../editing/document_state';
import { registerCodeTabContext, setTabDirty } from '../../../workbench/ui/code_tab/contexts';
import { editorViewState } from '../../ui/view/state';

export type RenameLineEdit = {
	row: number;
	text: string;
};

export function commitRename(
	matches: readonly SearchMatch[],
	newName: string,
	activeIndex: number,
	info: ReferenceMatchInfo,
): number {
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
			const startOffset = editorDocumentState.buffer.offsetAt(match.row, match.start);
			const endOffset = editorDocumentState.buffer.offsetAt(match.row, match.end);
			applyUndoableReplace(startOffset, endOffset - startOffset, newName);
			editorViewState.layout.invalidateLine(match.row);
		}
		markTextMutated();

		const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
		const focused = sortedMatches[clampedIndex];
		editorDocumentState.cursorRow = focused.row;
		editorDocumentState.cursorColumn = focused.start;
		setSingleCursorSelectionAnchor(editorDocumentState, focused.row, focused.start + newName.length);
		updateDesiredColumn();
		resetBlink();
		editorCaretState.cursorRevealSuspended = false;
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
	return updatedTotal;
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
		if (path === activePath) {
			return 0;
		}
		const context = this.ensureCodeTabContextForChunk(path);
		if (context.readOnly === true) {
			return 0;
		}
		const lines = this.getContextLinesForRename(context);
		const matches = new Array<SearchMatch>(ranges.length);
		for (let index = 0; index < ranges.length; index += 1) {
			matches[index] = convertRangeToSearchMatch(ranges[index]);
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
			source: textFromLines(lines),
			lines,
			version: context.textVersion,
		}, workspace);
		return matches.length;
	}

	private getContextLinesForRename(context: CodeTabContext): string[] {
		return copyLinesSnapshot(context.buffer);
	}

	private applyLinesToContextSnapshot(context: CodeTabContext, lines: readonly string[]): void {
		const source = textFromLines(lines);
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
			registerCodeTabContext(context);
			this.markContextTabDirty(context.id, context.dirty);
		}
		return context;
	}

	private markContextTabDirty(contextId: string, dirty: boolean): void {
		setTabDirty(contextId, dirty);
	}
}

export const crossFileRenameManager = new CrossFileRenameManager();

export function convertRangeToSearchMatch(range: LuaSourceRange): SearchMatch {
	const row = range.start.line - 1;
	const start = range.start.column - 1;
	const end = range.end.column;
	return { row, start, end };
}
