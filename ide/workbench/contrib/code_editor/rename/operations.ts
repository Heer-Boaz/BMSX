import type { SearchMatch } from '../../../../common/models';
import type { CodeTabContext } from '../../../ui/code_tab/model';
import type { ReferenceMatchInfo } from '../../../../editor/contrib/references/state';
import type { LuaSourceRange } from '../../../../../toolchain/ts/lua/syntax/ast/index';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { getActiveCodeTabContext, retainLuaCodeTabContext } from '../../../ui/code_tab/contexts';
import { resolveRuntimeResourceForContext } from '../../../../runtime/sources';
import { getTextSnapshot } from '../../../../editor/text/source_text';
import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import { markTextMutated } from '../../../../editor/common/text/runtime';
import { markDiagnosticsDirtyForChunk } from '../diagnostics/controller';
import { prepareUndo, applyUndoableReplace, recordEditContext } from '../../../../editor/editing/undo_controller';
import { setSingleCursorSelectionAnchor } from '../../../../editor/editing/cursor/state';
import { updateDesiredColumn, ensureCursorVisible } from '../../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../../editor/render/caret';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { editorDocumentState } from '../../../../editor/editing/document_state';
import { editorViewState } from '../../../../editor/ui/view/state';
import type { ResourceDomain } from '../../../../common/resource';
import type { RuntimeSourceState } from '../../../../runtime/sources';
import { searchMatchFromSourceRange } from '../../../../editor/navigation/source_range';

export function commitRename(
	crossFileRename: CrossFileRenameManager,
	matches: readonly SearchMatch[],
	newName: string,
	activeIndex: number,
	info: ReferenceMatchInfo,
): number {
	const activeContext = getActiveCodeTabContext();
	const activePath = activeContext.resource.path;
	const activeDomain = activeContext.resource.domain;
	const sortedMatches = matches.slice();
	sortedMatches.sort((a, b) => a.row !== b.row ? a.row - b.row : a.start - b.start);
	let updatedTotal = 0;

	type RangeBucket = { path: string; ranges: LuaSourceRange[] };
	const rangeMap = new Map<string, RangeBucket>();
	const addRange = (range: LuaSourceRange): void => {
		const path = range.path;
		let bucket = rangeMap.get(path);
		if (!bucket) {
			bucket = { path, ranges: [] };
			rangeMap.set(path, bucket);
		}
		bucket.ranges.push(range);
	};
	for (let index = 0; index < info.query.targets.length; index += 1) {
		addRange(info.query.targets[index].declaration.range);
	}
	for (let index = 0; index < info.query.references.length; index += 1) {
		addRange(info.query.references[index].range);
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
		editorDocumentState.emitCursorMoved();
		updatedTotal += sortedMatches.length;
	}

	for (const bucket of rangeMap.values()) {
		const replacements = crossFileRename.applyRenameToChunk(
			activeDomain,
			bucket.path,
			bucket.ranges,
			newName,
			activePath,
		);
		updatedTotal += replacements;
		if (replacements > 0) {
			markDiagnosticsDirtyForChunk(bucket.path);
		}
	}
	return updatedTotal;
}

export class CrossFileRenameManager {
	public constructor(private readonly sources: RuntimeSourceState) {}

	public applyRenameToChunk(
		domain: ResourceDomain,
		path: string,
		ranges: readonly LuaSourceRange[],
		newName: string,
		activePath: string,
	): number {
		if (path === activePath) {
			return 0;
		}
		const context = this.ensureCodeTabContextForChunk(domain, path);
		if (context.resource.source.generated) {
			return 0;
		}
		const matches = new Array<SearchMatch>(ranges.length);
		for (let index = 0; index < ranges.length; index += 1) {
			matches[index] = searchMatchFromSourceRange(ranges[index]);
		}
		if (matches.length === 0) {
			return 0;
		}
		matches.sort((a, b) => a.row !== b.row ? a.row - b.row : a.start - b.start);
		for (let index = matches.length - 1; index >= 0; index -= 1) {
			const match = matches[index];
			const startOffset = context.buffer.offsetAt(match.row, match.start);
			const endOffset = context.buffer.offsetAt(match.row, match.end);
			context.buffer.replace(startOffset, endOffset - startOffset, newName);
		}
		this.markContextBufferMutated(context);
		getOrCreateSemanticProject(domain).updateDocument(path, getTextSnapshot(context.buffer));
		return matches.length;
	}

	private markContextBufferMutated(context: CodeTabContext): void {
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
	}

	private ensureCodeTabContextForChunk(
		domain: ResourceDomain,
		path: string,
	): CodeTabContext {
		const resource = resolveRuntimeResourceForContext(this.sources, domain, path)!;
		return retainLuaCodeTabContext(this.sources, resource);
	}
}
