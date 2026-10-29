import type { InputFocusTarget } from '../../../input/focus';
import type { EditorParts, EditorMoveDestination } from './editor_parts';
import type { QuickInputController } from '../quick_input/controller';
import type { EditorTabDragSource } from '../../ui/tab/drag';
import { TextQuickPickProvider } from '../quick_input/text_provider';

/** Both transfer gestures and commands retain the exact source and destination owners. */
export function showMoveDestination(parts: EditorParts, picker: QuickInputController,
	source: EditorTabDragSource, origin: InputFocusTarget | null): void {
	const group = parts.groupForModel(source.model)!;
	picker.pick(source.kind === 'editor' ? 'MOVE EDITOR' : 'MOVE GROUP', 'Choose an editor group or window', (_origin, lifetime) => {
		lifetime.add({ dispose: group.onWillDispose(() => picker.hide()) });
		if (source.kind === 'editor') lifetime.add({ dispose: source.input.onWillDispose(() => picker.hide()) });
		const items: { destination: EditorMoveDestination; label: string; description: string; detail: string }[] = [];
		for (const part of parts.mostRecentlyActive) for (const target of part.mostRecentlyActiveGroups) {
			const destination: EditorMoveDestination = { kind: 'group', group: target };
			const eligible = source.kind === 'editor' ? parts.canMoveEditor(group, source.input, destination) : parts.canMoveGroup(group, destination);
			lifetime.add({ dispose: target.onWillDispose(() => picker.hide()) });
			const active = target.model.activeTab;
			const host = part.kind === 'main' ? 'Main Workspace' : part.window!.model.title;
			const title = part.groups.length === 1 ? host : `${host} / Group ${part.groups.indexOf(target) + 1}`;
			const description = active?.description ?? '', detail = part.window?.model.minimized ? 'Minimized editor window' : '';
			if (eligible) items.push({ destination, label: source.kind === 'editor' ? title : `Merge into ${title}`, description, detail });
			for (const direction of ['left', 'right', 'up', 'down'] as const) {
				const beside: EditorMoveDestination = { kind: 'split', group: target, direction };
				const eligible = source.kind === 'editor' ? parts.canMoveEditor(group, source.input, beside) : parts.canMoveGroup(group, beside);
				if (eligible) items.push({ destination: beside, label: `${direction}: ${title}`, description, detail });
			}
		}
		const window: EditorMoveDestination = { kind: 'window' };
		if (source.kind === 'editor' ? parts.canMoveEditor(group, source.input, window) : parts.canMoveGroup(group, window))
			items.push({ destination: window, label: 'New Editor Window', description: '', detail: '' });
		return new TextQuickPickProvider(items);
	}, (item, _modifiers, preserveFocus) => {
		// Placement is a foreground interaction, not an asynchronous source result to attach behind it.
		if (preserveFocus) return;
		if (source.kind === 'editor') parts.moveEditor(group, source.input, item.destination);
		else parts.moveGroup(group, item.destination);
	}, undefined, { invocationOrigin: origin });
}
