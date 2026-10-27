import type { EditorGroupView } from './editor_group';
import type { EditorInput } from '../../ui/tab/model';
import type { EditorParts } from './editor_parts';
import type { QuickInputController } from '../quick_input/controller';
import { TextQuickPickProvider } from '../quick_input/text_provider';

/** Workspace navigation enumerates actual membership, including background hosts and inactive tabs. */
export function showOpenEditors(parts: EditorParts, picker: QuickInputController): void {
	picker.pick('OPEN EDITORS', 'Choose an open editor', (_origin, lifetime) => {
		const items: { group: EditorGroupView; input: EditorInput; label: string; description: string; detail: string }[] = [];
		for (const part of parts.mostRecentlyActive) {
			const host = part.kind === 'main' ? 'Main Workspace' : part.window!.model.title;
			for (const group of part.mostRecentlyActiveGroups) {
				lifetime.add({ dispose: group.onWillDispose(() => picker.hide()) });
				lifetime.add({ dispose: group.model.onDidChange(() => picker.hide()) });
				const description = part.groups.length === 1 ? host : `${host} / Group ${part.groups.indexOf(group) + 1}`;
				for (const input of group.model.tabs) items.push({ group, input, label: group.model.getLabel(input), description,
					detail: `${input.description}${group === parts.activeGroup && input === group.model.activeTab ? ' / active' : ''}${input.isDirty() ? ' / unsaved changes' : ''}${part.window?.model.minimized ? ' / minimized' : ''}` });
			}
		}
		return new TextQuickPickProvider(items);
	}, item => { parts.revealEditor(item.input, item.group); });
}

/** A tabstrip's overflow is local to that concrete group, unlike workspace navigation. */
export function showGroupOpenEditors(group: EditorGroupView, picker: QuickInputController): void {
	picker.pick('OPEN EDITORS', 'Choose an editor in this group', (_origin, lifetime) => {
		lifetime.add({ dispose: group.onWillDispose(() => picker.hide()) });
		lifetime.add({ dispose: group.model.onDidChange(() => picker.hide()) });
		return new TextQuickPickProvider(group.model.tabs.map(input => ({ input, label: group.model.getLabel(input),
			description: input === group.model.activeTab ? 'ACTIVE' : '', detail: `${input.description}${input.isDirty() ? ' / unsaved changes' : ''}` })));
	}, item => { group.activate(item.input.id); });
}
