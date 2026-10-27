import type { EditorInput } from '../../ui/tab/model';
import type { InputFocusTarget } from '../../../input/focus';
import type { EditorPart } from './editor_part';
import type { EditorCloseController } from './editor_close';
import type { EditorParts } from './editor_parts';
import type { QuickInputController } from '../quick_input/controller';
import { TextQuickPickProvider } from '../quick_input/text_provider';

/** Window choices retain actual owners, including windows with a pending close decision. */
export function showOpenWindows(parts: EditorParts, picker: QuickInputController, minimizedOnly = false): void {
	picker.pick(minimizedOnly ? 'MINIMIZED WINDOWS' : 'OPEN WINDOWS',
		minimizedOnly ? 'Choose a minimized editor window' : 'Choose a workspace or editor window', (_origin, lifetime) => {
		const items = parts.mostRecentlyActive.filter(part => !minimizedOnly || part.window?.model.minimized).map(part => {
			lifetime.add({ dispose: part.group.onWillDispose(() => picker.hide()) });
			const input = part.group.model.activeTab;
			return { part, label: part.kind === 'main' ? 'Main Workspace' : input === null ? 'Editor' : part.group.model.getLabel(input),
				description: part.kind === 'main' ? input?.title ?? '' : input?.shortDescription ?? '',
				detail: `${input?.description ?? ''}${part === parts.activePart ? ' / active' : ''}${input?.isDirty() ? ' / unsaved changes' : ''}${part.window?.model.minimized ? ' / minimized' : ''}${part.closing ? ' / close decision' : ''}` };
		});
		return new TextQuickPickProvider(items);
	}, item => item.part.focus());
}

/** The picker retains exact source/destination owners; accepting never resolves later focus. */
export function showMoveEditor(parts: EditorParts, admission: EditorCloseController, picker: QuickInputController,
	source: EditorPart, input: EditorInput, origin: InputFocusTarget | null): void {
	if (!parts.canMoveEditor(source, input, 'new', admission)) return;
	picker.pick('MOVE EDITOR', 'Choose a destination workspace or editor window', (_origin, lifetime) => {
		lifetime.add({ dispose: source.group.onWillDispose(() => picker.hide()) });
		lifetime.add({ dispose: input.onWillDispose(() => picker.hide()) });
		const items: { destination: EditorPart | 'new'; label: string; description: string; detail: string }[] = [];
		for (const destination of parts.mostRecentlyActive) {
			if (!parts.canMoveEditor(source, input, destination, admission)) continue;
			lifetime.add({ dispose: destination.group.onWillDispose(() => picker.hide()) });
			const active = destination.group.model.activeTab;
			items.push({ destination, label: destination.kind === 'main' ? 'Main Workspace' : active?.title ?? 'Editor',
				description: active?.description ?? '', detail: destination.window?.model.minimized ? 'Minimized editor window' : '' });
		}
		items.push({ destination: 'new', label: 'New Editor Window', description: '', detail: '' });
		return new TextQuickPickProvider(items);
	}, item => { parts.moveEditor(source, input, item.destination, admission); }, undefined, { invocationOrigin: origin });
}
