import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { EditorTextModel, EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { mapTrackedTextRange } from '../../../editor/text/text_change';
import { createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import { getCachedLuaParse } from '../../../../toolchain/ts/lua/analysis/cache';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { resourceIdentityKey } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import type { RuntimeResource } from '../../../common/resource';
import { editorTabGroup } from '../../ui/tab/group_model';
import { getActiveTab, setActiveTab } from '../../ui/tabs';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { EditorNavigationController } from '../resources/navigation';
import { SceneEditorInput } from './editor_input';
import { buildSceneSourceDocument } from './source';
import { installSceneOutline, selectSceneOutlineRow, type SceneMemberElement } from './outline';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly panes: EditorPanes,
		private readonly navigation: EditorNavigationController,
	) {}

	public openResource(resource: RuntimeResource): void {
		const model = editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource));
		const id = `scene:${resourceIdentityKey(resource)}` as const;
		let input = editorTabGroup.findById(id);
		if (input === undefined) {
			input = new SceneEditorInput(model);
			editorTabGroup.add(input);
		}
		setActiveTab(this.panes, input.id);
	}

	public openSource(): void {
		const input = getActiveTab();
		if (input.kind !== 'scene_editor') return;
		this.refresh(input);
		const row = input.outline.rows[input.outline.selectionIndex]?.element;
		const position = row === undefined ? null : {
			row: row.source.start.line - 1,
			startColumn: row.source.start.column - 1,
			endColumn: row.source.start.column - 1,
		};
		this.navigation.focusChunkSourceForContext(input.workingCopy.resource.domain, input.workingCopy.resource.path, position);
	}

	/** Current source-command target; definition roots and source-only rows are not members. */
	private editableMember(): SceneMemberElement | undefined {
		const input = getActiveTab();
		if (input.kind !== 'scene_editor' || input.workingCopy.readOnly || input.parsed.syntaxError !== null) return undefined;
		const row = input.outline.rows[input.outline.selectionIndex]?.element;
		return row?.kind === 'member' && row.entry.kind === 'object' ? row : undefined;
	}

	public canRemoveSelectedMember(): boolean { return this.editableMember() !== undefined; }

	public removeSelectedMember(): void {
		const input = getActiveTab();
		if (input.kind !== 'scene_editor') return;
		// Command admission may have accepted a property draft. Use its new source generation.
		this.refresh(input);
		const row = this.editableMember();
		if (row === undefined) return;
		this.panes.activePane.focus();
		input.workingCopy.pushEditOperations(createLuaTableFieldRemovalEdits(input.workingCopy.buffer, input.parsed.tokens, row.entry.field));
		// Do not let a surviving namesake inherit the removed member's selection.
		selectSceneOutlineRow(input, -1);
	}

	public onDidChangeContent(model: EditorTextModel, event: EditorTextModelContentChangeEvent): void {
		for (const input of editorTabGroup.tabs) {
			if (input.kind === 'scene_editor' && input.workingCopy === model) {
				mapTrackedTextRange(input.selectionRange, event.changes);
				for (const root of input.outline.roots) mapTrackedTextRange(root.element.span, event.changes);
			}
		}
	}

	public canMoveSelectedMember(direction: -1 | 1): boolean {
		const row = this.editableMember();
		return row !== undefined && row.scene.resolution === 'complete'
			&& row.index + direction >= 0 && row.index + direction < row.scene.objects.length;
	}

	public moveSelectedMember(direction: -1 | 1): void {
		const input = getActiveTab();
		if (input.kind !== 'scene_editor') return;
		this.refresh(input); // Source-command admission may have accepted a property.
		if (!this.canMoveSelectedMember(direction)) return;
		const row = this.editableMember()!;
		this.panes.activePane.focus();
		input.workingCopy.pushEditOperations(createLuaTableFieldMoveEdits(
			input.workingCopy.buffer, input.workingCopy.resource.path, row.scene.objectsTable, row.index, row.index + direction,
		));
		this.refresh(input);
		revealWorkbenchListSelection(input.outline);
	}

	public refresh(input: SceneEditorInput): void {
		const model = input.workingCopy;
		if (input.version === model.version) return;
		const project = getOrCreateSemanticProject(model.resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const analysis = project.getFileData(model.resource.path)!;
		input.parsed = getCachedLuaParse({ path: model.resource.path, source: analysis.source }).parsed;
		const document = buildSceneSourceDocument(model.resource, analysis);
		installSceneOutline(input, document);
		input.version = model.version;
	}
}
