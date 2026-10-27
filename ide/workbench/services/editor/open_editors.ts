import type { EditorGroupView } from './editor_group';
import type { EditorInput } from '../../common/editor_inputs';
import type { EditorParts } from './editor_parts';
import type { QuickInputController } from '../quick_input/controller';
import { TextQuickPickProvider } from '../quick_input/text_provider';
import type { EditorTabGroupChange } from '../../ui/tab/group_model';

/** Workspace navigation enumerates actual membership, including background hosts and inactive tabs. */
export function showOpenEditors(parts: EditorParts, picker: QuickInputController): void {
	picker.pick('OPEN EDITORS', 'Choose an open editor', (_origin, lifetime) => {
		const items: { group: EditorGroupView; input: EditorInput; label: string; description: string; detail: string }[] = [];
		for (const part of parts.mostRecentlyActive) {
			const host = part.kind === 'main' ? 'Main Workspace' : part.window!.model.title;
			for (const group of part.mostRecentlyActiveGroups) {
				const description = part.groups.length === 1 ? host : `${host} / Group ${part.groups.indexOf(group) + 1}`;
				for (const input of group.model.tabs) items.push({ group, input, label: group.model.getLabel(input), description,
					detail: `${input.description}${group === parts.activeGroup && input === group.model.activeTab ? ' / active' : ''}${input.isDirty() ? ' / unsaved changes' : ''}${part.window?.model.minimized ? ' / minimized' : ''}` });
			}
		}
		const provider = new TextQuickPickProvider(items);
		const changed = (change: EditorTabGroupChange): void => {
			if (change === 'editors') { picker.hide(); return; }
			for (const item of items) {
				const { group, input } = item, part = parts.partForGroup(group);
				const host = part.kind === 'main' ? 'Main Workspace' : part.window!.model.title;
				item.label = group.model.getLabel(input);
				item.description = part.groups.length === 1 ? host : `${host} / Group ${part.groups.indexOf(group) + 1}`;
				item.detail = `${input.description}${group === parts.activeGroup && input === group.model.activeTab ? ' / active' : ''}${input.isDirty() ? ' / unsaved changes' : ''}${part.window?.model.minimized ? ' / minimized' : ''}`;
			}
			provider.refresh();
		};
		for (const part of parts.mostRecentlyActive) for (const group of part.mostRecentlyActiveGroups) {
			lifetime.add({ dispose: group.onWillDispose(() => picker.hide()) });
			lifetime.add({ dispose: group.model.onDidChange(changed) });
		}
		return provider;
	}, item => { parts.revealEditor(item.input, item.group); });
}

/** A tabstrip's overflow is local to that concrete group, unlike workspace navigation. */
export function showGroupOpenEditors(group: EditorGroupView, picker: QuickInputController): void {
	picker.pick('OPEN EDITORS', 'Choose an editor in this group', (_origin, lifetime) => {
		const items = group.model.tabs.map(input => ({ input, label: group.model.getLabel(input),
			description: input === group.model.activeTab ? 'ACTIVE' : '', detail: `${input.description}${input.isDirty() ? ' / unsaved changes' : ''}` }));
		const provider = new TextQuickPickProvider(items);
		lifetime.add({ dispose: group.onWillDispose(() => picker.hide()) });
		lifetime.add({ dispose: group.model.onDidChange(change => {
			if (change === 'editors') { picker.hide(); return; }
			for (const item of items) {
				item.label = group.model.getLabel(item.input);
				item.description = item.input === group.model.activeTab ? 'ACTIVE' : '';
				item.detail = `${item.input.description}${item.input.isDirty() ? ' / unsaved changes' : ''}`;
			}
			provider.refresh();
		}) });
		return provider;
	}, item => { group.activate(item.input.id); });
}
