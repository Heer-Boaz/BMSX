import { ReadonlyEditorInput } from '../../common/editor_input';
import type { EditorParts } from '../../services/editor/editor_parts';
import type { WorkbenchPreferences } from '../../services/preferences/preferences';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import { WorkbenchFixedEdgeSplitView } from '../../ui/split_view';
import { SettingsModel, SETTINGS_CATEGORIES } from './model';
import type { SettingsCategory } from './model';

/** Settings has ordinary editor/window lifetime, but is not a source working copy. */
export class SettingsInput extends ReadonlyEditorInput<'settings', 'settings'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly model = new SettingsModel();
	public readonly viewport = new WorkbenchScrollViewport();
	public viewportFilterRevision = 0;
	public readonly navigation = new ScrollableWorkbenchTree<{ readonly id: SettingsCategory; readonly label: string }>();
	public readonly split = new WorkbenchFixedEdgeSplitView('start');
	public constructor(public readonly preferences: WorkbenchPreferences) {
		super('settings', 'settings', 'Settings', true);
		for (const category of SETTINGS_CATEGORIES) appendWorkbenchTreeNode(this.navigation, null, category);
		rebuildWorkbenchTreeRows(this.navigation, this.navigation.roots[0]);
	}
}

export function openSettings(parts: EditorParts, preferences: WorkbenchPreferences): void {
	for (const group of parts.groups) {
		const input = group.model.findById('settings');
		if (input !== undefined) { parts.revealEditor(input, group); return; }
	}
	const part = parts.createDocument();
	parts.revealEditor(new SettingsInput(preferences), part.activeGroup);
}
