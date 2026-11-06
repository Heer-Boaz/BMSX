import { ReadonlyEditorInput } from '../../common/editor_input';
import type { EditorParts } from '../../services/editor/editor_parts';
import type { WorkbenchPreferences } from '../../services/preferences/preferences';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { SettingsModel } from './model';

/** Settings has ordinary editor/window lifetime, but is not a source working copy. */
export class SettingsInput extends ReadonlyEditorInput<'settings', 'settings'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly model = new SettingsModel();
	public readonly viewport = new WorkbenchScrollViewport();
	public constructor(public readonly preferences: WorkbenchPreferences) { super('settings', 'settings', 'Settings', true); }
}

export function openSettings(parts: EditorParts, preferences: WorkbenchPreferences): void {
	for (const group of parts.groups) {
		const input = group.model.findById('settings');
		if (input !== undefined) { parts.revealEditor(input, group); return; }
	}
	const part = parts.createDocument();
	parts.revealEditor(new SettingsInput(preferences), part.activeGroup);
}
