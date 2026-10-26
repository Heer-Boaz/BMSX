import type { EditorGroupView } from './editor_group';
import type { QuickInputController } from '../quick_input/controller';
import { TextQuickPickProvider } from '../quick_input/text_provider';

/** Explicit group overflow navigation; no unseen editor needs to be clicked or scrolled into view. */
export function showOpenEditors(group: EditorGroupView, picker: QuickInputController): void {
	picker.pick('OPEN EDITORS', 'Choose an open editor', (_origin, lifetime) => {
		lifetime.add({ dispose: group.model.onDidChange(() => picker.hide()) });
		return new TextQuickPickProvider(group.model.tabs.map(input => ({ input, label: group.model.getLabel(input),
			description: input === group.model.activeTab ? 'ACTIVE' : '', detail: `${input.description}${input.isDirty() ? ' / unsaved changes' : ''}` })));
	}, item => group.activate(item.input.id));
}
