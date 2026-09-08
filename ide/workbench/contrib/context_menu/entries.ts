import type { EditorContextMenuEntry, EditorContextToken } from '../../../common/models';

export function buildEditorContextMenuEntries(token: EditorContextToken, editable: boolean): EditorContextMenuEntry[] {
	if (token.kind !== 'identifier' || !token.expression || token.expression.length === 0) {
		return [];
	}
	const entries: EditorContextMenuEntry[] = [
		{ action: 'goToDefinition', label: 'Go to Definition', enabled: true },
		{ action: 'referenceSearch', label: 'Go to References', enabled: true },
		{ action: 'callHierarchy', label: 'Show Call Hierarchy', enabled: true },
	];
	if (editable) {
		entries.push({ action: 'rename', label: 'Rename Symbol', enabled: true });
	}
	return entries;
}
