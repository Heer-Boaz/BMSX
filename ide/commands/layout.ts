import type { CartEditor } from '../cart_editor';
import type { EditorCommandId } from '../common/commands';
import type { InputFocusTarget } from '../input/focus';
import { editorViewState } from '../editor/ui/view/state';
import { EditorGroupView, findEditorGroup } from '../workbench/services/editor/editor_group';
import type { WorkbenchSurface } from '../workbench/services/windows/model';
import { WorkbenchFixedEdgeSplitView } from '../workbench/ui/split_view';
import type { WorkbenchSplitControl } from '../workbench/ui/split_control';

type ResizeAxis = 'width' | 'height';
type ResizeDirection = 1 | -1;
type ResizeView = WorkbenchSplitControl | EditorGroupView;
type ViewSizing = { readonly axis: ResizeAxis } & (
	{ readonly kind: 'step'; readonly direction: ResizeDirection } | { readonly kind: 'focus' | 'reset' }
);

export const WORKBENCH_VIEW_SIZING_COMMANDS: Partial<Record<EditorCommandId, ViewSizing>> = {
	'workspace.increaseViewWidth': { kind: 'step', axis: 'width', direction: 1 },
	'workspace.decreaseViewWidth': { kind: 'step', axis: 'width', direction: -1 },
	'workspace.increaseViewHeight': { kind: 'step', axis: 'height', direction: 1 },
	'workspace.decreaseViewHeight': { kind: 'step', axis: 'height', direction: -1 },
	'workspace.resizeViewWidth': { kind: 'focus', axis: 'width' },
	'workspace.resizeViewHeight': { kind: 'focus', axis: 'height' },
	'workspace.resetViewWidth': { kind: 'reset', axis: 'width' },
	'workspace.resetViewHeight': { kind: 'reset', axis: 'height' },
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
	if (editor.resourcePanel.focusTarget.scope.contains(target.scope)) return axis === 'width' && editor.resourcePanel.isVisible() ? editor.resourcePanel.sash : undefined;
	if (window === editor.mainWorkspace.surface) {
		const sash = editor.mainWorkspace.resizeControlForTarget(target, axis);
		if (sash !== undefined) return sash;
	}
	const group = findEditorGroup(target);
	if (group === null || group !== undefined && !group.openingAdmitted) return;
	const part = group === undefined ? editor.editorParts.partForTarget(target) : editor.editorParts.partForGroup(group);
	if (part == null || part.retired || part.operation !== 'none' || window !== (part.kind === 'main' ? editor.mainWorkspace.surface : part.surface)) return;
	return group === undefined ? part.resizeControlForTarget(target, axis) : group;
}

export function isWorkbenchViewSizingEnabled(editor: CartEditor, target: InputFocusTarget | null, sizing: ViewSizing): boolean {
	const { axis } = sizing, view = resizeView(editor, target, axis);
	if (view === undefined) return false;
	if (sizing.kind !== 'step') {
		const control = view instanceof EditorGroupView ? editor.editorParts.partForGroup(view).resizeControlForGroup(view, axis) : view;
		return sizing.kind === 'focus' ? control?.input?.resizable === true : control?.input?.canReset === true;
	}
	const delta = sizing.direction * 2 * (axis === 'width' ? editorViewState.font.charAdvance : editorViewState.font.lineHeight);
	if (view instanceof EditorGroupView) return editor.editorParts.partForGroup(view).arrangement.canResizeGroup(view, axis, delta);
	const input = view.input!;
	return input.canMoveTo(input.position + (input instanceof WorkbenchFixedEdgeSplitView && input.edge === 'end' ? -delta : delta));
}

export function executeWorkbenchViewSizing(editor: CartEditor, target: InputFocusTarget | null, sizing: ViewSizing): void {
	const { axis } = sizing, view = resizeView(editor, target, axis);
	if (view === undefined) return;
	if (sizing.kind !== 'step') {
		const control = view instanceof EditorGroupView ? editor.editorParts.partForGroup(view).resizeControlForGroup(view, axis) : view;
		if (control === undefined) return;
		if (sizing.kind === 'focus') control.focusForResize(target!);
		else control.input!.reset();
		return;
	}
	const delta = sizing.direction * 2 * (axis === 'width' ? editorViewState.font.charAdvance : editorViewState.font.lineHeight);
	if (view instanceof EditorGroupView) {
		const part = editor.editorParts.partForGroup(view);
		if (part.arrangement.resizeGroup(view, axis, delta) && !part.retired && part.operation === 'none') part.relayout();
	} else {
		const input = view.input!, position = input.position + (input instanceof WorkbenchFixedEdgeSplitView && input.edge === 'end' ? -delta : delta);
		if (input.canMoveTo(position)) input.moveTo(position);
	}
}
