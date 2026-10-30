import type { EditorCommandId, EditorDocumentCommandId } from '../common/commands';
import type { InputFocusTarget } from '../input/focus';
import type { EditorInput } from '../workbench/common/editor_inputs';
import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { EditorParts } from '../workbench/services/editor/editor_parts';
import { showMoveDestination } from '../workbench/services/editor/open_windows';
import type { QuickInputController } from '../workbench/services/quick_input/controller';

/** Document membership actions require an actual document group, not an opening destination. */
export function isEditorDocumentCommand(command: EditorCommandId): command is EditorDocumentCommandId {
	switch (command) {
		case 'window.copyEditor': case 'window.moveEditor':
		case 'tabs.close': case 'tabs.closeOthers': case 'tabs.closeAll':
		case 'tabs.next': case 'tabs.previous': case 'tabs.scrollLeft': case 'tabs.scrollRight': return true;
		default: return false;
	}
}

export function isEditorDocumentCommandEnabled(parts: EditorParts, command: EditorDocumentCommandId,
	group: EditorGroupView, input: EditorInput | null): boolean {
	switch (command) {
		case 'window.copyEditor': return input !== null && parts.canCopyEditor(group, input);
		case 'window.moveEditor': return input !== null && parts.canMoveEditor(group, input, { kind: 'window' });
		case 'tabs.close': return input === null ? parts.partForGroup(group).groups.length > 1 && parts.canCloseGroup(group)
			: group.openingAdmitted && input.closable;
		case 'tabs.closeOthers': return input !== null && parts.canCloseEditors({ kind: 'others', group, input });
		case 'tabs.closeAll': return parts.canCloseEditors({ kind: 'group', group });
		case 'tabs.next': case 'tabs.previous': return group.model.tabs.length > 1;
		case 'tabs.scrollLeft': return group.tabStrip.scrollbar.getScroll() > 0;
		case 'tabs.scrollRight': return group.tabStrip.scrollbar.getScroll() < group.tabStrip.scrollbar.getMaximumScroll();
	}
}

export function executeEditorDocumentCommand(parts: EditorParts, picker: QuickInputController,
	command: EditorDocumentCommandId, group: EditorGroupView, input: EditorInput | null, origin: InputFocusTarget | null): void {
	switch (command) {
		case 'window.copyEditor':
			if (input !== null) void parts.copyEditor(group, input);
			return;
		case 'window.moveEditor':
			if (input !== null && parts.canMoveEditor(group, input, { kind: 'window' }))
				showMoveDestination(parts, picker, { kind: 'editor', model: group.model, input }, origin);
			return;
		case 'tabs.close':
			if (input === null) void parts.closeGroup(group, origin);
			else void group.close(input.id, origin);
			return;
		case 'tabs.closeOthers':
			if (input !== null) void parts.closeEditors({ kind: 'others', group, input }, origin);
			return;
		case 'tabs.closeAll': void parts.closeEditors({ kind: 'group', group }, origin); return;
		case 'tabs.next': group.cycle(1); return;
		case 'tabs.previous': group.cycle(-1); return;
		case 'tabs.scrollLeft': case 'tabs.scrollRight':
			group.tabStrip.scrollbar.setScroll(group.tabStrip.scrollbar.getScroll()
				+ (command === 'tabs.scrollLeft' ? -1 : 1) * (group.tabStrip.layoutState.viewportBounds.right - group.tabStrip.layoutState.viewportBounds.left) * 0.75);
	}
}
