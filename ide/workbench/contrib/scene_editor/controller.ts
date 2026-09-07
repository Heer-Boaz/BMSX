import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { readLuaSourceRange, readLuaTableFieldInteger } from '../../../language/lua/source_edits';
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
			row: row.entry.range.start.line - 1,
			startColumn: row.entry.range.start.column - 1,
			endColumn: row.entry.range.start.column - 1,
		};
		this.navigation.focusChunkSourceForContext(input.workingCopy.resource.domain, input.workingCopy.resource.path, position);
	}

	public refresh(input: SceneEditorInput): boolean {
		const model = input.workingCopy;
		if (input.version === model.version) return false;
		const previous = input.members.rows[input.members.selectionIndex];
		const project = getOrCreateSemanticProject(model.resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const document = buildSceneSourceDocument(model.resource, project.updateDocument(model.resource.path, getTextSnapshot(model.buffer)));
		input.partial = document.scenes.some(scene => scene.resolution === 'partial');
		const rows = input.members.rows;
		rows.length = 0;
		const sourceIds = new Set<string>();
		for (const scene of document.scenes) {
			const sceneLabel = readLuaSourceRange(model.buffer, scene.id.range).replace(/\s+/g, ' ');
			for (const entry of scene.objects) {
				const label = readLuaSourceRange(model.buffer, entry.kind === 'object' ? entry.memberId.range : entry.expression.range).replace(/\s+/g, ' ');
				// VS Code OutlineModel: names retain view identity across source edits;
				// ranges distinguish repeated names. These are not runtime object ids.
				let candidate = `${sceneLabel}/${label}`;
				if (sourceIds.has(candidate)) candidate += `_${entry.range.start.line}_${entry.range.start.column}`;
				let sourceId = candidate;
				for (let ordinal = 0; sourceIds.has(sourceId); ordinal += 1) sourceId = `${candidate}_${ordinal}`;
				sourceIds.add(sourceId);
				rows.push({
					sourceId, sceneLabel, label, displayLabel: '', entry,
					definition: entry.kind === 'object' ? readLuaSourceRange(model.buffer, entry.definitionId.range).replace(/\s+/g, ' ') : 'Dynamic Lua composition',
				});
			}
		}
		input.members.selectionIndex = previous === undefined
			? (rows.length > 0 ? 0 : -1)
			: rows.findIndex(row => row.sourceId === previous.sourceId);
		input.version = model.version;
		this.select(input, input.members.selectionIndex);
		return true;
	}

	public select(input: SceneEditorInput, index: number): void {
		input.members.selectionIndex = index;
		const row = input.members.rows[index];
		for (const property of input.properties) {
			const field = row !== undefined && row.entry.kind === 'object' && row.entry.position !== null
				? row.entry.position[property.axis] : null;
			property.field = field;
			property.value = field === null ? null : readLuaTableFieldInteger(field);
			property.sourceText = field === null ? 'Lua source' : readLuaSourceRange(input.workingCopy.buffer, field.value.range).replace(/\s+/g, ' ');
		}
	}
}
