import type { EditorPanes } from './editor_panes';
import type { QuickInputController } from '../quick_input/controller';
import { TextQuickPickProvider } from '../quick_input/text_provider';
import { editorTabGroup } from '../../ui/tab/group_model';
import { setActiveTab } from '../../ui/tabs';

/** Explicit group overflow navigation; no unseen editor needs to be clicked or scrolled into view. */
export function showOpenEditors(panes: EditorPanes, picker: QuickInputController): void {
	picker.pick('OPEN EDITORS', 'Choose an open editor', (_origin, lifetime) => {
		lifetime.add({ dispose: editorTabGroup.onDidChange(() => picker.hide()) });
		return new TextQuickPickProvider(editorTabGroup.tabs.map(input => ({ input, label: editorTabGroup.getLabel(input),
			description: input === editorTabGroup.activeTab ? 'ACTIVE' : '', detail: `${input.description}${input.isDirty() ? ' / unsaved changes' : ''}` })));
	}, item => setActiveTab(panes, item.input.id));
}
