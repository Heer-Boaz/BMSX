import type { SearchMatch } from '../../../../common/models';
import type { ReferenceMatchInfo } from '../../../../editor/contrib/references/state';
import type { LuaSourceRange } from '../../../../../toolchain/ts/lua/syntax/ast/index';
import { clamp } from '../../../../../machine/ts/common/clamp';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { resolveLuaTextFileModel } from '../../../services/working_copy/text_file_model';
import { updateDesiredColumn, ensureCursorVisible } from '../../../../editor/ui/view/caret/caret';
import { resetBlinkState } from '../../../../editor/ui/view/caret/blink';
import { captureCodeEditorSelectionSnapshot, codeEditorEditState } from '../../../../editor/ui/code_editor_state';
import type { CodeEditorControl } from '../../../../editor/ui/code_editor_control';
import type { EditorModelEdit, EditorTextModel } from '../../../../editor/model/text_model';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { EditorWorkspaceEditConflict } from '../../../../editor/model/undo_redo_service';
import { getTextSnapshot } from '../../../../editor/text/source_text';
import { mapTextOffset } from '../../../../editor/text/text_change';
import { luaSourceRangeToTextRange } from '../../../../language/lua/source_edits';
import { clearForwardNavigationHistory } from '../../../../navigation/navigation_history';
import { WorkspaceEditProposal } from '../../../services/working_copy/workspace_edit';
import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import type { WorkspaceSourceContext } from '../../../services/working_copy/source_context';

export function commitRename(
	code: CodeEditorControl,
	crossFileRename: CrossFileRenameManager,
	matches: readonly SearchMatch[],
	newName: string,
	activeIndex: number,
	info: ReferenceMatchInfo,
): number {
	const model = code.model;
	const edits = crossFileRename.prepareRename(model.resource.contextId, info, newName);
	const focused = matches[clamp(activeIndex, 0, matches.length - 1)];
	const focusedOffset = model.buffer.offsetAt(focused.row, focused.start);
	const before = captureCodeEditorSelectionSnapshot(code.view);
	const source = code.view.editSource;
	const edit = edits.get(model)!;
	edits.set(model, { ...edit, beforeEditState: codeEditorEditState.of(before, source), computeAfterEditState: changes => {
		const position = { row: 0, column: 0 };
		model.buffer.positionAt(mapTextOffset(focusedOffset, changes, -1), position);
		return codeEditorEditState.of({ ...before, cursorRow: position.row, cursorColumn: position.column,
			selectionAnchor: { row: position.row, column: position.column + newName.length } }, source);
	} });
	editorTextModelService.history.applyEdits(edits);
	clearForwardNavigationHistory();
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	code.caret.cursorRevealSuspended = false;
	ensureCursorVisible(code);
	let updatedTotal = 0;
	for (const edit of edits.values()) updatedTotal += edit.edits.length;
	return updatedTotal;
}

/** Resolve all authored references first; one shared workspace history owns the mutation. */
export class CrossFileRenameManager {
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}

	public proposeRename(context: WorkspaceSourceContext, contextId: string, info: ReferenceMatchInfo, newName: string): WorkspaceEditProposal {
		context.assertCurrent();
		return new WorkspaceEditProposal(`Rename ${info.expression} to ${newName}`, context,
			{ kind: 'edit', edits: this.prepareRename(contextId, info, newName) });
	}

	public prepareRename(contextId: string, info: ReferenceMatchInfo, newName: string): Map<EditorTextModel, EditorModelEdit> {
		const project = getOrCreateSemanticProject(editorTextModelService, contextId);
		project.synchronizeSources(this.catalog);
		const currentSnapshot = project.getSnapshot();
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
			const resource = this.catalog.resolveResource(project.getResourceIdentity(path))!;
			const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
			if (currentSnapshot !== info.snapshot || getTextSnapshot(model.buffer) !== info.snapshot.getFileData(path)!.source) {
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
