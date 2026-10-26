import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { editorTabGroup } from '../tab/group_model';
import type { CodeTabContext } from './model';

export function getActiveCodeTabContext(): CodeTabContext | null {
	const activeTab = editorTabGroup.activeTab;
	return activeTab?.kind === 'code_editor' ? activeTab.context : null;
}

export function isActiveLuaCodeTab(): boolean {
	const activeTab = editorTabGroup.activeTab;
	return activeTab?.kind === 'code_editor' && activeTab.context.model.mode === 'lua';
}

export function isReadOnlyCodeTab(): boolean {
	return editorTabGroup.activeTab?.kind === 'code_editor' && activeCodeEditor.model.readOnly;
}

export function isEditableCodeTab(): boolean {
	return editorTabGroup.activeTab?.kind === 'code_editor' && !activeCodeEditor.model.readOnly;
}
