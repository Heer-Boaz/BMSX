import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { EditorTextModel, EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { mapTrackedTextRange } from '../../../editor/text/text_change';
import { createLuaTableFieldRemovalEdits, readLuaSourceRange, readLuaTableFieldInteger } from '../../../language/lua/source_edits';
import { getCachedLuaParse } from '../../../../toolchain/ts/lua/analysis/cache';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { resourceIdentityKey } from '../../../common/resource';
import { getActiveCodeTabContext } from '../../ui/code_tab/contexts';
import { editorTabGroup } from '../../ui/tab/group_model';
import { getActiveTab, setActiveTab } from '../../ui/tabs';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { EditorNavigationController } from '../resources/navigation';
import { SceneEditorInput } from './editor_input';
import { buildSceneSourceDocument } from './source';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly panes: EditorPanes,
		private readonly navigation: EditorNavigationController,
	) {}

	public openActiveDocument(): void {
		const context = getActiveCodeTabContext();
		const id = `scene:${resourceIdentityKey(context.model.resource)}` as const;
		let input = editorTabGroup.findById(id);
		if (input === undefined) {
			input = new SceneEditorInput(context.model, context.title);
			editorTabGroup.add(input);
		}
		setActiveTab(this.panes, input.id);
	}

	public openSource(): void {
		const input = getActiveTab();
		if (input.kind !== 'scene_editor') return;
		const row = input.members.rows[input.members.selectionIndex];
		const position = row === undefined ? null : {
			row: row.entry.field.range.start.line - 1,
			startColumn: row.entry.field.range.start.column - 1,
			endColumn: row.entry.field.range.start.column - 1,
		};
		this.navigation.focusChunkSourceForContext(input.workingCopy.resource.domain, input.workingCopy.resource.path, position);
	}

	public canRemoveSelectedMember(): boolean {
		const input = getActiveTab();
		if (input.kind !== 'scene_editor' || input.workingCopy.readOnly || input.parsed.syntaxError !== null) return false;
		return input.members.rows[input.members.selectionIndex]?.entry.kind === 'object';
	}

	public removeSelectedMember(): void {
		const input = getActiveTab();
		if (input.kind !== 'scene_editor') return;
		// Command admission may have accepted a property draft. Use its new
		// source generation, not the field range from the preceding render.
		this.refresh(input);
		if (!this.canRemoveSelectedMember()) return;
		const row = input.members.rows[input.members.selectionIndex];
		this.panes.activePane.focus();
		input.workingCopy.pushEditOperations(createLuaTableFieldRemovalEdits(input.workingCopy.buffer, input.parsed.tokens, row.entry.field));
		// Do not let a surviving namesake inherit the removed member's selection.
		this.select(input, -1);
	}

	public onDidChangeContent(model: EditorTextModel, event: EditorTextModelContentChangeEvent): void {
		for (const input of editorTabGroup.tabs) {
			if (input.kind === 'scene_editor' && input.workingCopy === model) {
				mapTrackedTextRange(input.selectionRange, event.changes);
			}
		}
	}

	public refresh(input: SceneEditorInput): void {
		const model = input.workingCopy;
		if (input.version === model.version) return;
		const project = getOrCreateSemanticProject(model.resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const source = getTextSnapshot(model.buffer);
		input.parsed = getCachedLuaParse({ path: model.resource.path, source }).parsed;
		const document = buildSceneSourceDocument(model.resource, project.updateDocument(model.resource.path, source, input.parsed));
		input.partial = document.scenes.some(scene => scene.resolution === 'partial');
		const rows = input.members.rows;
		rows.length = 0;
		let selectionIndex = -1;
		for (const scene of document.scenes) {
			const sceneLabel = readLuaSourceRange(model.buffer, scene.id.range).replace(/\s+/g, ' ');
			for (const entry of scene.objects) {
				const range = entry.field.range;
				if (model.buffer.offsetAt(range.start.line - 1, range.start.column - 1) === input.selectionRange.start
					&& model.buffer.offsetAt(range.end.line - 1, range.end.column) === input.selectionRange.end) {
					selectionIndex = rows.length;
				}
				const label = readLuaSourceRange(model.buffer, entry.kind === 'object' ? entry.memberId.range : entry.field.value.range).replace(/\s+/g, ' ');
				rows.push({
					sceneLabel, label, displayLabel: '', entry,
					definition: entry.kind === 'object' ? readLuaSourceRange(model.buffer, entry.definitionId.range).replace(/\s+/g, ' ') : 'Dynamic Lua composition',
				});
			}
		}
		if (input.version === 0 && rows.length > 0) selectionIndex = 0;
		input.version = model.version;
		this.select(input, selectionIndex);
	}

	public select(input: SceneEditorInput, index: number): void {
		input.members.selectionIndex = index;
		const row = input.members.rows[index];
		input.selectionRange.start = row === undefined ? 0
			: input.workingCopy.buffer.offsetAt(row.entry.field.range.start.line - 1, row.entry.field.range.start.column - 1);
		input.selectionRange.end = row === undefined ? 0
			: input.workingCopy.buffer.offsetAt(row.entry.field.range.end.line - 1, row.entry.field.range.end.column);
		for (const property of input.properties) {
			const field = row !== undefined && row.entry.kind === 'object' && row.entry.position !== null
				? row.entry.position[property.axis] : null;
			property.field = field;
			property.value = field === null ? null : readLuaTableFieldInteger(field);
			property.sourceText = field === null ? 'Lua source' : readLuaSourceRange(input.workingCopy.buffer, field.value.range).replace(/\s+/g, ' ');
		}
	}
}
