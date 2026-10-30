import type { MainWorkspace } from '../../main_workspace';
import { inputFocus } from '../../../input/focus';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { EditorParts } from '../../services/editor/editor_parts';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { workbenchWindowForSurface, type WorkbenchFloatingWindow } from './control';
import type { EditorInput } from '../../common/editor_inputs';
import { computeEditorLabels } from '../tab/titles';

type WindowPick = {
	readonly surface: WorkbenchSurface;
	readonly window: WorkbenchFloatingWindow | undefined;
	label: string;
	readonly description: string;
	readonly detail: string;
};

/** Choices retain actual physical attachments, not an invented editor for every window. */
export function showOpenWindows(main: MainWorkspace, parts: EditorParts, surfaces: WorkbenchSurfaceService,
	picker: QuickInputController, minimizedOnly = false): void {
	picker.pick(minimizedOnly ? 'MINIMIZED WINDOWS' : 'OPEN WINDOWS', 'Choose a window', (_origin, lifetime) => {
		const items: WindowPick[] = [], windows = surfaces.windowSurfaces;
		const editorWindows: { input: EditorInput; item: WindowPick; preview: boolean }[] = [];
		for (let index = windows.length - 1; index >= 0; index--) {
			const surface = windows[index], window = workbenchWindowForSurface(surface);
			if (window !== undefined) {
				if (!window.isOpen || minimizedOnly && !window.model.minimized) continue;
				const part = parts.documents.find(part => part.surface === surface), group = part?.activeGroup, input = group?.model.activeTab;
				lifetime.add({ dispose: surface.onDidRetire(() => picker.hide()) });
				const item = { surface, window, label: input === undefined || input === null ? window.model.title : input.title,
					description: input?.shortDescription ?? window.model.description,
					detail: `${input?.description ?? ''}${window.hasFocus ? ' / active' : ''}${input?.isDirty() ? ' / unsaved changes' : ''}${window.model.minimized ? ' / minimized' : ''}${part?.closing ? ' / close decision' : ''}` };
				items.push(item);
				if (input !== undefined && input !== null) editorWindows.push({ input, item, preview: group!.model.previewTab === input });
			} else if (surface === main.surface && !minimizedOnly) {
				const input = parts.main.activeGroup.model.activeTab;
				lifetime.add({ dispose: surface.onDidRetire(() => picker.hide()) });
				items.push({ surface, window: undefined, label: 'Main Workspace', description: input?.title ?? '', detail: input?.description ?? '' });
			}
		}
		const labels = computeEditorLabels(editorWindows.map(entry => entry.input));
		for (let index = 0; index < editorWindows.length; index++) {
			const { item, preview } = editorWindows[index];
			// The picker owns this complete enumeration, not any single document group's collision scope.
			item.label = preview ? `PREVIEW: ${labels[index]}` : labels[index];
		}
		return new TextQuickPickProvider(items);
	}, (item, _modifiers, preserveFocus) => {
		if (preserveFocus || item.surface.retired) return;
		if (item.window === undefined) inputFocus.setTarget(main.focusTarget);
		else if (item.window.isOpen && item.window.surface === item.surface) item.window.show();
	});
}
