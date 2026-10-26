import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { resourceIdentityKey } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { RuntimeResource } from '../../../common/resource';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { EditorNavigationController } from '../resources/navigation';
import { SceneEditorInput } from './editor_input';
import { buildSceneSourceDocument } from './source';
import { installSceneOutline, selectSceneOutlineRow, type SceneMemberElement } from './outline';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly group: EditorGroupView,
		private readonly navigation: EditorNavigationController,
	) {}

	public openResource(resource: RuntimeResource): void {
		const model = resolveLuaTextFileModel(editorTextModelService, this.sources, resource);
		const id = `scene:${resourceIdentityKey(resource)}` as const;
		this.group.openEditor(this.group.model.findById(id) ?? new SceneEditorInput(model));
	}

	public openSource(): void {
		const input = this.group.model.activeTab;
		if (input?.kind !== 'scene_editor') return;
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
		const input = this.group.model.activeTab;
		if (input?.kind !== 'scene_editor') return undefined;
		this.refresh(input);
		if (input.workingCopy.readOnly || input.parsed.syntaxError !== null) return undefined;
		const row = input.outline.rows[input.outline.selectionIndex]?.element;
		return row?.kind === 'member' && row.entry.kind === 'object' ? row : undefined;
	}

	public canRemoveSelectedMember(): boolean { return this.editableMember() !== undefined; }

	public removeSelectedMember(): void {
		const input = this.group.model.activeTab;
		if (input?.kind !== 'scene_editor') return;
		// Command admission may have accepted a property draft. Use its new source generation.
		this.refresh(input);
		const row = this.editableMember();
		if (row === undefined) return;
		this.group.panes.activePane.focus();
		input.workingCopy.pushEditOperations(createLuaTableFieldRemovalEdits(input.workingCopy.buffer, input.parsed.locations, input.parsed.tokens, row.entry.field));
		// Do not let a surviving namesake inherit the removed member's selection.
		selectSceneOutlineRow(input, -1);
	}


	public canMoveSelectedMember(direction: -1 | 1): boolean {
		const row = this.editableMember();
		return row !== undefined && row.scene.resolution === 'complete'
			&& row.index + direction >= 0 && row.index + direction < row.scene.objects.length;
	}

	public moveSelectedMember(direction: -1 | 1): void {
		const input = this.group.model.activeTab;
		if (input?.kind !== 'scene_editor') return;
		this.refresh(input); // Source-command admission may have accepted a property.
		if (!this.canMoveSelectedMember(direction)) return;
		const row = this.editableMember()!;
		this.group.panes.activePane.focus();
		input.workingCopy.pushEditOperations(createLuaTableFieldMoveEdits(
			input.workingCopy.buffer, input.document.analysis.chunk, row.scene.objectsTable, row.index, row.index + direction,
		));
		this.refresh(input);
		revealWorkbenchListSelection(input.outline);
	}

	public refresh(input: SceneEditorInput): void {
		const model = input.workingCopy;
		const project = getOrCreateSemanticProject(editorTextModelService, model.resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const snapshot = project.getSnapshot();
		if (input.sourceRevision === snapshot.revision) return;
		const document = buildSceneSourceDocument(model.resource, snapshot, input.document);
		input.sourceRevision = snapshot.revision;
		if (document === input.document) return;
		input.parsed = document.analysis.chunk;
		installSceneOutline(input, document);
		input.version += 1;
	}
}
