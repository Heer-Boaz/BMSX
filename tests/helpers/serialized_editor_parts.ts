import type { SerializedEditorGroup } from '../../ide/workbench/services/editor/editor_serialization';
import type { SerializedEditorGroupLayout, SerializedEditorParts } from '../../ide/workbench/services/editor/editor_parts_serialization';

/** Persisted capability/source checks visit the real leaves of every part's arrangement. */
export function serializedEditorGroups(parts: SerializedEditorParts): readonly SerializedEditorGroup[] {
	const groups: SerializedEditorGroup[] = [];
	const visit = (layout: SerializedEditorGroupLayout): void => {
		if (layout.kind === 'group') groups.push(layout.group);
		else { visit(layout.first); visit(layout.second); }
	};
	visit(parts.main.layout);
	for (const document of parts.documents) visit(document.layout);
	return groups;
}
