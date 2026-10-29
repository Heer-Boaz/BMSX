import type { CartEditor } from '../cart_editor';
import type { EditorCommandId } from '../common/commands';
import type { InputFocusTarget } from '../input/focus';
import { editorViewState } from '../editor/ui/view/state';
import { EditorGroupView, findEditorGroup } from '../workbench/services/editor/editor_group';
import type { WorkbenchSurface } from '../workbench/services/windows/model';
import { WorkbenchFixedEdgeSplitView, type WorkbenchSplitView } from '../workbench/ui/split_view';

type ResizeAxis = 'width' | 'height';
type ResizeDirection = 1 | -1;
type ResizeView = WorkbenchSplitView | WorkbenchFixedEdgeSplitView | EditorGroupView;

export const WORKBENCH_VIEW_RESIZE_COMMANDS: Partial<Record<EditorCommandId, { readonly axis: ResizeAxis; readonly direction: ResizeDirection }>> = {
	'workspace.increaseViewWidth': { axis: 'width', direction: 1 },
	'workspace.decreaseViewWidth': { axis: 'width', direction: -1 },
	'workspace.increaseViewHeight': { axis: 'height', direction: 1 },
	'workspace.decreaseViewHeight': { axis: 'height', direction: -1 },
};

/** Commands address the invoking native view, never the later active editor or a semantic parent's window. */
function resizeView(editor: CartEditor, target: InputFocusTarget | null, axis: ResizeAxis): ResizeView | undefined {
	if (!editor.isActive || target === null || target.guestInput !== undefined || target.canFocus?.() === false) return;
	const surface = editor.surfaces.findByScope(target.scope.surfaceScope);
	if (surface === undefined || !editor.surfaces.isFocusAdmitted(surface)) return;
	let window: WorkbenchSurface | undefined;
	for (let current: WorkbenchSurface | null | undefined = surface; current != null;
		current = current.role === 'transient' && current.lifetimeOwner !== undefined ? current.lifetimeOwner : current.presentationParent) {
		if (current.role === 'modal') return;
		if (window === undefined && current.role === 'window') window = current;
	}
	if (editor.resourcePanel.focusTarget.scope.contains(target.scope)) return axis === 'width' && editor.resourcePanel.isVisible() ? editor.resourcePanel.split : undefined;
	if (window === editor.mainWorkspace.surface) {
		const sash = editor.mainWorkspace.resizeSashForTarget(target, axis);
		if (sash !== undefined) return sash;
	}
	const group = findEditorGroup(target);
	if (group == null || !group.openingAdmitted) return;
	const part = editor.editorParts.partForGroup(group);
	if (part.retired || part.operation !== 'none' || window !== (part.kind === 'main' ? editor.mainWorkspace.surface : part.surface)) return;
	return group;
}

export function canResizeWorkbenchView(editor: CartEditor, target: InputFocusTarget | null, axis: ResizeAxis, direction: ResizeDirection): boolean {
	const view = resizeView(editor, target, axis);
	if (view === undefined) return false;
	const delta = direction * 2 * (axis === 'width' ? editorViewState.font.charAdvance : editorViewState.font.lineHeight);
	if (view instanceof EditorGroupView) return editor.editorParts.partForGroup(view).arrangement.canResizeGroup(view, axis, delta);
	return view.canMoveTo(view.position + (view instanceof WorkbenchFixedEdgeSplitView && view.edge === 'end' ? -delta : delta));
}

export function resizeWorkbenchView(editor: CartEditor, target: InputFocusTarget | null, axis: ResizeAxis, direction: ResizeDirection): void {
	const view = resizeView(editor, target, axis);
	if (view === undefined) return;
	const delta = direction * 2 * (axis === 'width' ? editorViewState.font.charAdvance : editorViewState.font.lineHeight);
	if (view instanceof EditorGroupView) {
		const part = editor.editorParts.partForGroup(view);
		if (part.arrangement.resizeGroup(view, axis, delta) && !part.retired && part.operation === 'none') part.relayout();
	} else {
		const position = view.position + (view instanceof WorkbenchFixedEdgeSplitView && view.edge === 'end' ? -delta : delta);
		if (view.canMoveTo(position)) view.moveTo(position);
	}
}
