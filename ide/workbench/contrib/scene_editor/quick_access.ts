import type { CartEditor } from '../../../cart_editor';
import { editorTextModelService } from '../../../editor/model/model_service';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { WorkspaceSourceContext } from '../../services/working_copy/source_context';
import type { ProjectContentEntry } from '../resources/content_index';
import { computeEditorLabels, computeResourceTabTitle, sourceTabDescription, sourceTabDirectory } from '../../ui/tab/titles';
import { openProjectScene } from './opening';

/** An explicit primary-subject choice, independent of document tabs and Files reading state. */
export function showMainScenePicker(editor: CartEditor, catalog: WorkspaceSourceCatalog, origin: InputFocusTarget | null): void {
	const index = editor.projectContent, picker = editor.quickInput;
	if (editor.isClosing || !index.acceptingQueries) return;
	picker.pick('Main Scene', 'Choose an authored Scene', (_origin, lifetime) => {
		// The catalog begins after ordinary blur has published the invoking control's draft.
		const source = new WorkspaceSourceContext(editorTextModelService, catalog);
		lifetime.add({ dispose: source.onDidInvalidate(() => picker.hide(false)) });
		lifetime.add(source);
		index.sync();
		const scenes: Extract<ProjectContentEntry, { kind: 'scene' }>[] = [];
		for (const entries of index.entriesByResource.values()) for (const entry of entries) if (entry.kind === 'scene') scenes.push(entry);
		const fileLabels = computeEditorLabels(scenes.map(({ ownerResource }) => ({ title: computeResourceTabTitle(ownerResource),
			description: sourceTabDescription(ownerResource), shortDescription: 'Scene', descriptionPath: sourceTabDirectory(ownerResource) })));
		return new TextQuickPickProvider(scenes.map((entry, position) => ({ entry, label: entry.label,
			description: `${entry.definition.range.start.line}:${entry.definition.range.start.column} / ${fileLabels[position]}`,
			detail: sourceTabDescription(entry.ownerResource) })));
	}, (item, _modifiers, preserveFocus) => {
		if (preserveFocus || editor.isClosing) return;
		void openProjectScene(editor, index, item.entry, inputFocus.admittedTarget);
	}, lifetime => {
		lifetime.add({ dispose: index.onDidChange(() => { if (!index.acceptingQueries) picker.hide(false); }) });
	}, { invocationOrigin: origin, commandTarget: origin?.commandContext });
}
