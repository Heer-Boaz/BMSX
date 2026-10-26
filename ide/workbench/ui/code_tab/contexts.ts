import type { EditorGroupView } from '../../services/editor/editor_group';
import type { CodeTabContext } from './model';

export function getActiveCodeTabContext(group: EditorGroupView): CodeTabContext | null {
	const activeTab = group.model.activeTab;
	return activeTab?.kind === 'code_editor' ? activeTab.context : null;
}

export function isActiveLuaCodeTab(group: EditorGroupView): boolean {
	const activeTab = group.model.activeTab;
	return activeTab?.kind === 'code_editor' && activeTab.context.model.mode === 'lua';
}

export function isReadOnlyCodeTab(group: EditorGroupView): boolean {
	return group.model.activeTab?.kind === 'code_editor' && group.model.activeTab.workingCopy.readOnly;
}

export function isEditableCodeTab(group: EditorGroupView): boolean {
	return group.model.activeTab?.kind === 'code_editor' && !group.model.activeTab.workingCopy.readOnly;
}
