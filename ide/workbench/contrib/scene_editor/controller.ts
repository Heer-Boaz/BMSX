import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resourceIdentityEquals, type ResourceIdentity } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { RuntimeResource } from '../../../common/resource';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { EditorNavigationController } from '../resources/navigation';
import { SceneEditorInput } from './editor_input';
import { buildSceneSourceDocument } from './source';
import { installSceneOutline, selectSceneOutlineRow, type SceneMemberElement } from './outline';
import { captureSceneEditorView, restoreSceneEditorView } from './view_snapshot';
import { SceneEditorNavigationSelection } from './navigation_selection';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(
		private readonly catalog: WorkspaceSourceCatalog,
		private readonly navigation: EditorNavigationController,
	) {}

	public readonly createView = (source: SceneEditorInput): SceneEditorInput => {
		this.refresh(source);
		const view = captureSceneEditorView(source);
		const input = new SceneEditorInput(source.workingCopy, this.createView);
		this.refresh(input);
		restoreSceneEditorView(input, view);
		return input;
	};

	public findResource(group: EditorGroupView, resource: ResourceIdentity): SceneEditorInput | undefined {
		return group.model.tabs.find((input): input is SceneEditorInput => input.kind === 'scene_editor' && resourceIdentityEquals(input.workingCopy.resource, resource));
	}

	public openResource(group: EditorGroupView, resource: RuntimeResource): void {
		const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
		group.openEditor(this.findResource(group, resource) ?? new SceneEditorInput(model, this.createView));
	}

	/** The occurrence owner tracks this table extent through canonical source edits. */
	public openDefinition(group: EditorGroupView, resource: RuntimeResource, range: Readonly<TrackedTextRange>): boolean {
		const generation = group.panes.openGeneration;
		if (!group.commitPendingEdit() || group.panes.openGeneration !== generation) return false;
		// Read after admission: accepting the attached draft may move or retire it.
		if (range.start === range.end) return false;
		const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
		const retained = this.findResource(group, resource);
		const input = retained ?? new SceneEditorInput(model, this.createView);
		this.refresh(input);
		const root = input.outline.roots.find(node => node.element.span.start === range.start && node.element.span.end === range.end);
		if (root === undefined) {
			if (retained === undefined) input.dispose();
			return false;
		}
		const selected = input.outline.rows[input.outline.selectionIndex];
		if (selected !== undefined && (selected.parent ?? selected) === root) return group.openEditor(input);
		const view = captureSceneEditorView(input);
		const selection = new SceneEditorNavigationSelection(input, {
			...view,
			section: 'outline',
			selected: { kind: 'scene', span: { ...root.element.span }, root: { ...root.element.span } },
			outlineScroll: input.outline.rows.indexOf(root),
			detailsScroll: 0,
		});
		try {
			return group.openEditor(input, { navigationSelection: selection });
		} finally {
			selection.dispose();
		}
	}

	public openSource(group: EditorGroupView, input: SceneEditorInput): void {
		this.refresh(input);
		const row = input.outline.rows[input.outline.selectionIndex]?.element;
		const position = row === undefined ? undefined : {
			row: row.source.start.line - 1,
			startColumn: row.source.start.column - 1,
			endColumn: row.source.start.column - 1,
		};
		void this.navigation.focusChunkSource(group, input.workingCopy.resource, position);
	}

	/** Current source-command target; definition roots and source-only rows are not members. */
	private editableMember(input: SceneEditorInput): SceneMemberElement | undefined {
		this.refresh(input);
		if (input.workingCopy.readOnly || input.parsed.syntaxError !== null) return undefined;
		const row = input.outline.rows[input.outline.selectionIndex]?.element;
		return row?.kind === 'member' && row.entry.kind === 'object' ? row : undefined;
	}

	public canRemoveSelectedMember(input: SceneEditorInput): boolean { return this.editableMember(input) !== undefined; }

	public removeSelectedMember(input: SceneEditorInput): void {
		// Command admission may have accepted a property draft. Use its new source generation.
		const row = this.editableMember(input);
		if (row === undefined) return;
		input.workingCopy.pushEditOperations(createLuaTableFieldRemovalEdits(input.workingCopy.buffer, input.parsed.locations, input.parsed.tokens, row.entry.field));
		// Do not let a surviving namesake inherit the removed member's selection.
		selectSceneOutlineRow(input, -1);
	}


	public canMoveSelectedMember(input: SceneEditorInput, direction: -1 | 1): boolean {
		const row = this.editableMember(input);
		return row !== undefined && row.scene.resolution === 'complete'
			&& row.index + direction >= 0 && row.index + direction < row.scene.objects.length;
	}

	public moveSelectedMember(input: SceneEditorInput, direction: -1 | 1): void {
		const row = this.editableMember(input); // Source-command admission may have accepted a property.
		if (row === undefined || row.scene.resolution !== 'complete'
			|| row.index + direction < 0 || row.index + direction >= row.scene.objects.length) return;
		input.workingCopy.pushEditOperations(createLuaTableFieldMoveEdits(
			input.workingCopy.buffer, input.document.analysis.chunk, row.scene.objectsTable, row.index, row.index + direction,
		));
		this.refresh(input);
		revealWorkbenchListSelection(input.outline);
	}

	public refresh(input: SceneEditorInput): void {
		const model = input.workingCopy;
		const project = getOrCreateSemanticProject(editorTextModelService, model.resource.contextId);
		project.synchronizeSources(this.catalog);
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
