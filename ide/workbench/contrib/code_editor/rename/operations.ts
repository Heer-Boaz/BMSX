import type { SearchMatch } from '../../../../common/models';
import type { ReferenceMatchInfo } from '../../../../editor/contrib/references/state';
import type { LuaSourceRange } from '../../../../../toolchain/ts/lua/syntax/ast/index';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { resolveRuntimeResourceForContext, type RuntimeSourceState } from '../../../../runtime/sources';
import { resourceSourceForChunk } from '../../../../runtime/lua_pipeline';
import { captureCodeEditorViewSnapshot } from '../../../../editor/editing/undo_controller';
import { updateDesiredColumn, ensureCursorVisible } from '../../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../../editor/render/caret';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { activeCodeEditor, codeEditorEditState } from '../../../../editor/ui/code_editor_state';
import type { ResourceDomain } from '../../../../common/resource';
import type { EditorModelEdit, EditorTextModel } from '../../../../editor/model/text_model';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { EditorWorkspaceEditConflict } from '../../../../editor/model/undo_redo_service';
import { getTextSnapshot } from '../../../../editor/text/source_text';
import { mapTextOffset } from '../../../../editor/text/text_change';
import { luaSourceRangeToTextRange } from '../../../../language/lua/source_edits';
import { clearForwardNavigationHistory } from '../../../../navigation/navigation_history';

export function commitRename(
	crossFileRename: CrossFileRenameManager,
	matches: readonly SearchMatch[],
	newName: string,
	activeIndex: number,
	info: ReferenceMatchInfo,
): number {
	const model = getActiveCodeTabContext().model;
	const edits = crossFileRename.prepareRename(model.resource.domain, info, newName);
	const focused = matches[clamp(activeIndex, 0, matches.length - 1)];
	const focusedOffset = model.buffer.offsetAt(focused.row, focused.start);
	const before = captureCodeEditorViewSnapshot();
	const edit = edits.get(model)!;
	edits.set(model, { ...edit, beforeEditState: codeEditorEditState.of(before), computeAfterEditState: changes => {
		const position = { row: 0, column: 0 };
		model.buffer.positionAt(mapTextOffset(focusedOffset, changes, -1), position);
		return codeEditorEditState.of({ ...before, cursorRow: position.row, cursorColumn: position.column,
			selectionAnchor: { row: position.row, column: position.column + newName.length } });
	} });
	editorTextModelService.history.applyEdits(edits);
	clearForwardNavigationHistory();
	updateDesiredColumn();
	resetBlink();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	activeCodeEditor.emitCursorMoved();
	let updatedTotal = 0;
	for (const edit of edits.values()) updatedTotal += edit.edits.length;
	return updatedTotal;
}

/** Resolve all authored references first; one shared workspace history owns the mutation. */
export class CrossFileRenameManager {
	public constructor(private readonly sources: RuntimeSourceState) {}

	public prepareRename(domain: ResourceDomain, info: ReferenceMatchInfo, newName: string): Map<EditorTextModel, EditorModelEdit> {
		const ranges = new Map<string, LuaSourceRange[]>();
		const add = (range: LuaSourceRange): void => {
			const bucket = ranges.get(range.path);
			if (bucket === undefined) ranges.set(range.path, [range]);
			else bucket.push(range);
		};
		for (const target of info.query.targets) add(target.range);
		for (const reference of info.query.references) add(info.snapshot.getFileData(reference.file)!.chunk.locations.range(reference.span));
		const result = new Map<EditorTextModel, EditorModelEdit>();
		for (const [path, locations] of ranges) {
			const resource = resolveRuntimeResourceForContext(this.sources, domain, path)!;
			const model = editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource));
			if (getTextSnapshot(model.buffer) !== info.snapshot.getFileData(path)!.source) {
				throw new EditorWorkspaceEditConflict(model);
			}
			const edits = locations.map(range => {
				const span = luaSourceRangeToTextRange(model.buffer, range);
				return { offset: span.start, deleteLength: span.end - span.start, text: newName };
			});
			edits.sort((left, right) => left.offset - right.offset);
			result.set(model, { version: model.version, edits });
		}
		return result;
	}
}
