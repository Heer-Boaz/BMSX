import type { SearchMatch } from '../../../../common/models';
import type { ReferenceMatchInfo } from '../../../../editor/contrib/references/state';
import type { LuaSourceRange } from '../../../../../toolchain/ts/lua/syntax/ast/index';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { resolveRuntimeResourceForContext } from '../../../../runtime/sources';
import * as luaPipeline from '../../../../runtime/lua_pipeline';
import { getTextSnapshot } from '../../../../editor/text/source_text';
import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import { markTextMutated } from '../../../../editor/common/text/runtime';
import { prepareUndo, applyUndoableReplace, recordEditContext } from '../../../../editor/editing/undo_controller';
import { setSingleCursorSelectionAnchor } from '../../../../editor/editing/cursor/state';
import { updateDesiredColumn, ensureCursorVisible } from '../../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../../editor/render/caret';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';
import { editorViewState } from '../../../../editor/ui/view/state';
import type { ResourceDomain } from '../../../../common/resource';
import type { RuntimeSourceState } from '../../../../runtime/sources';
import { searchMatchFromSourceRange } from '../../../../editor/navigation/source_range';
import type { EditorTextEdit } from '../../../../editor/model/text_model';
import { editorTextModelService } from '../../../../editor/model/model_service';

export function commitRename(
	crossFileRename: CrossFileRenameManager,
	matches: readonly SearchMatch[],
	newName: string,
	activeIndex: number,
	info: ReferenceMatchInfo,
): number {
	const activeContext = getActiveCodeTabContext();
	const activePath = activeContext.model.resource.path;
	const activeDomain = activeContext.model.resource.domain;
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
			const startOffset = activeCodeEditor.model.buffer.offsetAt(match.row, match.start);
			const endOffset = activeCodeEditor.model.buffer.offsetAt(match.row, match.end);
			applyUndoableReplace(startOffset, endOffset - startOffset, newName);
			editorViewState.layout.invalidateLine(match.row);
		}
		markTextMutated();

		const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
		const focused = sortedMatches[clampedIndex];
		activeCodeEditor.view.cursorRow = focused.row;
		activeCodeEditor.view.cursorColumn = focused.start;
		setSingleCursorSelectionAnchor(activeCodeEditor.view, focused.row, focused.start + newName.length);
		updateDesiredColumn();
		resetBlink();
		editorCaretState.cursorRevealSuspended = false;
		ensureCursorVisible();
		activeCodeEditor.emitCursorMoved();
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
		const resource = resolveRuntimeResourceForContext(this.sources, domain, path)!;
		const model = editorTextModelService.retain(
			resource,
			'lua',
			luaPipeline.resourceSourceForChunk(this.sources, resource),
		);
		if (model.resource.source.generated) {
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
		const edits = new Array<EditorTextEdit>(matches.length);
		for (let index = 0; index < matches.length; index += 1) {
			const match = matches[index];
			const startOffset = model.buffer.offsetAt(match.row, match.start);
			const endOffset = model.buffer.offsetAt(match.row, match.end);
			edits[index] = {
				offset: startOffset,
				deleteLength: endOffset - startOffset,
				text: newName,
			};
		}
		model.pushEditOperations(edits);
		getOrCreateSemanticProject(domain).updateDocument(path, getTextSnapshot(model.buffer));
		return matches.length;
	}
}
