import type { CartEditor } from '../../../../cart_editor';
import { inputFocus, type InputFocusTarget } from '../../../../input/focus';
import type { EditorGroupView } from '../../../services/editor/editor_group';
import type { ProjectContentEntry, ProjectContentIndex } from '../content_index';
import { editorTextModelService } from '../../../../editor/model/model_service';
import type { EditorTextModel } from '../../../../editor/model/text_model';
import { resolveLuaTextFileModel } from '../../../services/working_copy/text_file_model';
import type { EditorInput } from '../../../common/editor_inputs';
import type { PreparedEditorInput } from '../../../services/editor/editor_opening';

/** Contribution identity is shared by ordinary affinity and explicit resource-drop feedback. */
export function findProjectContentEditor(editor: CartEditor, entry: ProjectContentEntry, group: EditorGroupView): EditorInput | undefined {
	return entry.kind === 'scene' ? editor.sceneEditor.findResource(group, entry.ownerResource)
		: entry.kind === 'animation' ? editor.animations.findDefinition(group, entry.projectContextId, entry.ownerResource, entry.range, entry.definition.consumer?.file)
			: entry.kind === 'progression' || entry.kind === 'input' ? editor.luaPrograms.findOccurrence(group, entry.ownerResource, entry.kind, entry.range)
				: editor.behaviorLens.findDefinition(group, entry.ownerResource, entry.kind, entry.range);
}

/** Resolve canonical source before reading the tracked entry's current contribution facts. */
export function prepareProjectContent(editor: CartEditor, index: ProjectContentIndex, entry: ProjectContentEntry,
	group: EditorGroupView, isCurrent: () => boolean): PreparedEditorInput | undefined {
	const model = resolveLuaTextFileModel(editorTextModelService, index.catalog, entry.ownerResource);
	if (!isCurrent()) return;
	switch (entry.kind) {
		case 'scene': return editor.sceneEditor.prepareDefinition(group, model, entry.range, isCurrent);
		case 'behavior_tree': case 'state_machine': case 'action_effect':
			return editor.behaviorLens.prepareDefinition(group, model, entry.registration, isCurrent);
		case 'progression': case 'input': return editor.luaPrograms.prepareOccurrence(group, model, entry.occurrence, isCurrent);
		case 'animation': return editor.animations.prepareDefinition(group, model, entry.projectContextId, entry.definition, isCurrent);
	}
}

/** Resolve contribution affinity while the invoking owner is known, not after popup focus returns. */
export function resolveProjectContentDestination(editor: CartEditor, entry: ProjectContentEntry, invoking: EditorGroupView): EditorGroupView {
	let destination: EditorGroupView | undefined;
	search: for (const part of editor.editorParts.mostRecentlyActive) {
		if (part.operation !== 'none') continue;
		for (const group of part.mostRecentlyActiveGroups) {
			const existing = findProjectContentEditor(editor, entry, group);
			if (existing === undefined) continue;
			if (group === invoking) { destination = group; break search; }
			destination ??= group;
		}
	}
	return destination ?? editor.editorParts.editorDestination(invoking);
}

/** Canonical source admission can publish model listeners; those callbacks do not inherit this request. */
function admitProjectContent(index: ProjectContentIndex, entry: ProjectContentEntry, destination: EditorGroupView,
	origin: InputFocusTarget): EditorTextModel | undefined {
	if (!destination.openingAdmitted || inputFocus.admittedTarget !== origin) return;
	const generation = destination.panes.openGeneration, scope = origin.scope, context = scope.contextGeneration;
	if (!destination.commitPendingEdit() || !index.isCurrent(entry)) return;
	let focused = inputFocus.admittedTarget;
	if (!destination.openingAdmitted || destination.panes.openGeneration !== generation || scope.contextGeneration !== context
		|| focused !== null && !scope.contains(focused.scope)) return;
	const model = resolveLuaTextFileModel(editorTextModelService, index.catalog, entry.ownerResource);
	if (!index.isCurrent(entry)) return;
	focused = inputFocus.admittedTarget;
	if (!destination.openingAdmitted || destination.panes.openGeneration !== generation || scope.contextGeneration !== context
		|| focused !== null && !scope.contains(focused.scope)) return;
	return model;
}

/** The captured occurrence and destination survive ordinary menu focus, never a later active group. */
export function openProjectContent(editor: CartEditor, index: ProjectContentIndex, entry: ProjectContentEntry,
	destination: EditorGroupView, origin: InputFocusTarget): void {
	if (admitProjectContent(index, entry, destination, origin) === undefined) return;
	switch (entry.kind) {
		case 'scene': editor.sceneEditor.openDefinition(destination, entry.ownerResource, entry.range); break;
		case 'behavior_tree': case 'state_machine': case 'action_effect':
			editor.behaviorLens.openDefinition(destination, entry.registration); break;
		case 'progression': case 'input': editor.luaPrograms.openOccurrence(destination, entry.occurrence); break;
		case 'animation': editor.animations.openDefinition(destination, entry.projectContextId, entry.definition); break;
	}
}

/** Primary authoring is an explicit contribution action, not ordinary file activation. */
export function editProjectContentInMain(editor: CartEditor, index: ProjectContentIndex, entry: Extract<ProjectContentEntry, { kind: 'scene' }>,
	origin: InputFocusTarget): Promise<boolean> {
	const scope = origin.scope, context = scope.contextGeneration;
	return editor.openSceneInMain(() => {
		const sourceContext = index.catalog.contexts.get(entry.ownerResource.contextId);
		const current = () => inputFocus.admittedTarget === origin && scope.contextGeneration === context
			&& index.catalog.contexts.get(entry.ownerResource.contextId) === sourceContext;
		if (!index.isCurrent(entry) || !current()) return;
		const model = resolveLuaTextFileModel(editorTextModelService, index.catalog, entry.ownerResource);
		if (!index.isCurrent(entry) || !current()) return;
		return { model, subject: { document: entry.document, sourceVersion: model.version, scene: entry.definition } };
	}, origin);
}

/** Declaration offsets belong to their canonical authored owner, even when browsed at an importing consumer. */
export function openProjectContentSource(editor: CartEditor, index: ProjectContentIndex, entry: ProjectContentEntry,
	destination: EditorGroupView, origin: InputFocusTarget): Promise<number | undefined> | undefined {
	const model = admitProjectContent(index, entry, destination, origin);
	if (model === undefined) return;
	const position = { row: 0, column: 0 };
	model.buffer.positionAt(entry.range.start, position);
	return editor.navigation.focusChunkSource(destination, entry.ownerResource,
		{ row: position.row, startColumn: position.column, endColumn: position.column });
}
