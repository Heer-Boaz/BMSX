import type { EditorParts } from './editor_parts';
import type { QuickInputController } from '../quick_input/controller';
import { TextQuickPickProvider } from '../quick_input/text_provider';

/** Window choices retain actual owners, including windows with a pending close decision. */
export function showOpenWindows(parts: EditorParts, picker: QuickInputController): void {
	picker.pick('OPEN WINDOWS', 'Choose a workspace or editor window', (_origin, lifetime) => {
		const items = parts.mostRecentlyActive.map(part => {
			lifetime.add({ dispose: part.group.onWillDispose(() => picker.hide()) });
			const input = part.group.model.activeTab;
			return { part, label: part.kind === 'main' ? 'Main Workspace' : input === null ? 'Editor' : part.group.model.getLabel(input),
				description: part.kind === 'main' ? input?.title ?? '' : input?.shortDescription ?? '',
				detail: `${input?.description ?? ''}${part === parts.activePart ? ' / active' : ''}${input?.isDirty() ? ' / unsaved changes' : ''}${part.window?.model.collapsed ? ' / collapsed' : ''}${part.closing ? ' / close decision' : ''}` };
		});
		return new TextQuickPickProvider(items);
	}, item => item.part.focus());
}
