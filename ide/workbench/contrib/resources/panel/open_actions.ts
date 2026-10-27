import { WORKBENCH_TEXT_EDITOR_ID } from '../../code_editor/editor_input';
import type { CallHierarchyPanelItem } from './items';
import type { CartEditor } from '../../../../cart_editor';
import { inputFocus } from '../../../../input/focus';
import { findEditorGroup, type EditorGroupView } from '../../../services/editor/editor_group';
import type { ProjectContentEntry, ProjectContentIndex } from './content_index';

/** An authored occurrence retains its own identity while drafts and semantic publication settle. */
export function openProjectContent(editor: CartEditor, index: ProjectContentIndex, entry: ProjectContentEntry): void {
	const origin = findEditorGroup(inputFocus.target);
	if (origin === null) return;
	if (origin !== undefined) {
		const generation = origin.panes.openGeneration;
		if (!origin.commitPendingEdit() || origin.panes.openGeneration !== generation) return;
		// Closing an accepted property transient can return within its group;
		// another part's newer interaction does not authorize this old opening.
		if (inputFocus.target !== null && findEditorGroup(inputFocus.target) !== origin) return;
	}
	if (!index.isCurrent(entry)) return;
	if (entry.kind === 'scene') {
		editor.sceneEditor.openDefinition(editor.editorParts.main.group, entry.ownerResource, entry.range);
		return;
	}
	let destination: EditorGroupView | undefined;
	for (const part of editor.editorParts.mostRecentlyActive) {
		if (part.kind !== 'document' || part.operation !== 'none') continue;
		const group = part.group;
		const existing = entry.kind === 'animation'
			? editor.animations.findDefinition(group, entry.projectContextId, entry.ownerResource, entry.range, entry.definition.consumer?.file)
			: entry.kind === 'progression' || entry.kind === 'input'
				? editor.luaPrograms.findOccurrence(group, entry.ownerResource, entry.kind, entry.range)
				: editor.behaviorLens.findDefinition(group, entry.ownerResource, entry.kind, entry.range);
		if (existing !== undefined) { destination = group; break; }
	}
	destination ??= editor.editorParts.documentDestination();
	switch (entry.kind) {
		case 'behavior_tree': case 'state_machine': case 'action_effect':
			editor.behaviorLens.openDefinition(destination, entry.registration); break;
		case 'progression': case 'input': editor.luaPrograms.openOccurrence(destination, entry.occurrence); break;
		case 'animation': editor.animations.openDefinition(destination, entry.projectContextId, entry.definition); break;
	}
}

export function openResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	item: CallHierarchyPanelItem,
): void {
	void editor.navigation.focusChunkSource(
		editor.editorParts.documentDestination(undefined, { resource: item.resource, editorId: WORKBENCH_TEXT_EDITOR_ID }), item.resource,
		{
			row: item.location.range.startLine - 1,
			startColumn: item.location.range.startColumn - 1,
			endColumn: item.location.range.startColumn - 1,
		},
	);
}

export function openSelectedResourcePanelCallHierarchyLocation(
	editor: CartEditor,
	items: readonly CallHierarchyPanelItem[],
	selectionIndex: number,
): void {
	if (selectionIndex < 0) {
		return;
	}
	openResourcePanelCallHierarchyLocation(editor, items[selectionIndex]);
}
