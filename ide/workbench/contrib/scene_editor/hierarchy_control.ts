import type { RectBounds } from '../../../../machine/ts/common/rect';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { EditorCommandRunner } from '../../../common/commands';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerHover } from '../../../input/pointer/hover';
import { pointerCapture } from '../../../input/pointer/capture';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import type { WorkbenchMenuPresentation } from '../../ui/menu/model';
import { navigateWorkbenchTree, rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed, workbenchTreeRoot, workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import type { WorkbenchTreeNode } from '../../ui/tree_view';
import { WorkbenchTreeDrag } from '../../ui/tree_drag';
import { SceneOutlineFeedback } from './feedback';
import { beginSceneHierarchyDrag } from './hierarchy_drag';
import { layoutSceneHierarchy } from './hierarchy_layout';
import { drawSceneHierarchy } from './hierarchy_render';
import type { SceneHierarchyViewState } from './hierarchy_view';
import type { SceneEditorSectionCommands } from './option_editor';
import { selectSceneOutlineRow } from './outline';
import type { SceneOutlineElement } from './outline';

/** Concrete hierarchy input and feedback, independently attachable from Details. */
export class SceneHierarchyControl {
	public readonly focusTarget: InputFocusTarget;
	private viewValue: SceneHierarchyViewState | undefined;
	private bounds!: Readonly<RectBounds>;
	private measuredGeneration = -1;
	private attachmentRevision = 0;
	private presented = false;
	private readonly feedback: SceneOutlineFeedback;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	private readonly drag: WorkbenchTreeDrag<SceneOutlineElement>;
	private attachmentLifetime!: DisposableStore;
	public get view(): SceneHierarchyViewState { return this.viewValue!; }
	public get hasView(): boolean { return this.viewValue !== undefined; }
	public get inputScope(): InputFocusScope { return this.focusTarget.scope; }
	public get canFocus(): boolean { return this.hasView && this.view.outline.layout.visibleRowCount > 0; }

	public constructor(private readonly commands: EditorCommandRunner, private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>, scope: InputFocusScope,
		private readonly commandTarget: InputFocusTarget, private readonly sections: SceneEditorSectionCommands,
		private readonly contextActions: WorkbenchMenuPresentation) {
		this.focusTarget = inputFocus.createTarget(commandTarget, new InputFocusScope(scope.surfaceScope, scope));
		this.focusTarget.commandContext = commandTarget;
		this.focusTarget.canFocus = () => this.canFocus;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
		this.feedback = new SceneOutlineFeedback(surfaces, owner, workArea, this.focusTarget);
		this.drag = new WorkbenchTreeDrag(pointerCapture, this.inputScope.surfaceScope, surfaces, owner, workArea,
			node => this.beginDrag(node), () => this.view.notifyPresentationChanged());
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.drag.cancel());
		this.focusTarget.registerCommand('sceneEditor.details', sections.details);
		this.focusTarget.registerCommand('sceneEditor.outline', sections.outline);
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.hasView && this.view.authoring.hasSelection,
			run: () => {
				this.revealSelection();
				const tree = this.view.outline, layout = tree.layout;
				this.openContextMenu(layout.contentLeft + 4, layout.contentTop + (tree.selectionIndex - (tree.scroll | 0) + 1) * layout.rowHeight, true);
			},
		});
	}

	public setView(view: SceneHierarchyViewState, bounds: Readonly<RectBounds>): void {
		const revision = ++this.attachmentRevision;
		this.detach();
		if (revision !== this.attachmentRevision) return;
		this.viewValue = view; this.bounds = bounds; this.measuredGeneration = -1;
		this.attachmentLifetime = new DisposableStore();
		this.attachmentLifetime.add({ dispose: view.authoring.workingCopy.onWillDispose(() => {
			if (revision === this.attachmentRevision) this.clearView();
		}) });
		const cancelDrag = () => this.drag.cancel();
		this.attachmentLifetime.add({ dispose: view.authoring.onDidChangeSelection(cancelDrag) });
		this.attachmentLifetime.add({ dispose: view.authoring.onDidChangeSpatialGeneration(cancelDrag) });
		this.attachmentLifetime.add({ dispose: view.authoring.workingCopy.onDidChangeContent(cancelDrag) });
		this.attachmentLifetime.add({ dispose: view.authoring.workingCopy.onDidChangeReadOnly(cancelDrag) });
		this.attachmentLifetime.add({ dispose: this.inputScope.onDidRetireContext(cancelDrag) });
		this.update();
	}
	public layout(bounds: Readonly<RectBounds>): void { this.bounds = bounds; this.update(); }
	public update(): void {
		if (!this.hasView) return;
		const view = this.view, scope = this.inputScope, generation = scope.contextGeneration, revision = this.attachmentRevision;
		view.refresh();
		if (this.viewValue !== view || scope.contextGeneration !== generation) return;
		const changed = this.measuredGeneration !== view.outlineGeneration;
		if (layoutSceneHierarchy(view, this.bounds, changed) || changed) this.drag.cancel();
		this.measuredGeneration = view.outlineGeneration;
		const available = this.canFocus;
		if (this.presented && !available) {
			this.presented = false;
			this.onPointerLeave(); pointerHover.release(this);
			scope.retireContext();
			if (revision === this.attachmentRevision) this.focusTarget.release();
			return;
		}
		this.presented = available;
		this.drag.advance(editorRuntimeState.currentTimeMs);
		if (this.viewValue !== view || scope.contextGeneration !== generation) return;
		this.feedback.update(editorViewState.font.renderFont(), measureTextRange, measureText);
	}
	public draw(): void { if (this.hasView) drawSceneHierarchy(this.view, this.focusTarget.hasFocus); }
	public focus(): boolean { return this.focusTarget.focus(); }
	public setFocusNeighbors(previous: InputFocusTarget, next: InputFocusTarget): void {
		this.focusTarget.previous = previous; this.focusTarget.next = next;
		previous.next = this.focusTarget; next.previous = this.focusTarget;
	}
	public revealSelection(): void {
		const view = this.view, scroll = view.outline.scroll;
		const selection = view.authoring.selection;
		let expanded = false;
		if (selection !== undefined && view.outline.selectionIndex === -1) {
			const pending = [...view.outline.roots];
			while (pending.length > 0) {
				const node = pending.pop()!, element = node.element;
				if (element.scene === selection.scene && (selection.kind === 'scene' ? element.kind === 'scene'
					: element.kind === 'member' && element.entry === selection.entry)) {
					for (let parent = node.parent; parent !== null; parent = parent.parent) parent.collapsed = false;
					rebuildWorkbenchTreeRows(view.outline, node); expanded = true;
					break;
				}
				for (const child of node.children) pending.push(child);
			}
		}
		revealWorkbenchListSelection(view.outline);
		if (expanded || scroll !== view.outline.scroll) view.notifyPresentationChanged();
	}

	private select(index: number, toggle: boolean): boolean {
		const view = this.view, incoming = view.outline.rows[index];
		const span = incoming.element.span, sceneSpan = workbenchTreeRoot(incoming).element.span;
		const intent = view.authoring.selectionRevision, scope = this.inputScope, generation = scope.contextGeneration;
		if (!this.focus()) return false;
		const focused = inputFocus.admittedTarget;
		if (this.viewValue !== view || scope.contextGeneration !== generation || view.authoring.selectionRevision !== intent
			|| focused === null || !scope.contains(focused.scope)) return false;
		view.refresh();
		if (this.viewValue !== view || scope.contextGeneration !== generation || view.authoring.selectionRevision !== intent
			|| span.start === span.end || sceneSpan.start === sceneSpan.end) return false;
		index = view.outline.rows.findIndex(row => {
			if (row.element.kind !== incoming.element.kind || row.element.span.start !== span.start || row.element.span.end !== span.end) return false;
			const root = workbenchTreeRoot(row);
			return root.element.span.start === sceneSpan.start && root.element.span.end === sceneSpan.end;
		});
		if (index === -1) return false;
		const row = view.outline.rows[index], version = view.authoring.workingCopy.version;
		if (toggle && setWorkbenchTreeCollapsed(view.outline, index, !row.collapsed)) view.notifyPresentationChanged();
		if (!selectSceneOutlineRow(view, index)) return false;
		const selected = view.authoring.selection, current = inputFocus.admittedTarget;
		if (current === null || !scope.contains(current.scope) || this.viewValue !== view || scope.contextGeneration !== generation
			|| view.authoring.workingCopy.version !== version || selected?.scene !== row.element.scene || selected.kind !== row.element.kind
			|| selected.kind === 'member' && row.element.kind === 'member' && selected.entry !== row.element.entry) return false;
		this.revealSelection(); this.update();
		return true;
	}
	public handleKeyboard(event: KeyInputEvent): void {
		if (this.drag.pending && isKeyJustPressed('Escape', event)) {
			consumeIdeKey('Escape', event); this.drag.cancel(); return;
		}
		for (const [code, command] of TREE_NAVIGATION) {
			if (!isKeyDown(code, event)) continue;
			consumeIdeKey(code, event);
			this.drag.cancel();
			const view = this.view, scroll = view.outline.scroll;
			const changed = navigateWorkbenchTree(view.outline, command);
			if (changed === WorkbenchTreeNavigationResult.Collapse || view.outline.scroll !== scroll) view.notifyPresentationChanged();
			if (changed !== WorkbenchTreeNavigationResult.None && !this.select(view.outline.selectionIndex, false)) return;
			this.feedback.keyboardSelection(view);
			return;
		}
		if (isKeyJustPressed('Enter', event)) {
			consumeIdeKey('Enter', event);
			if (this.sections.details.isEnabled()) this.sections.details.run(this.focusTarget);
		}
	}
	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!this.hasView || !snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) return false;
		const view = this.view, index = workbenchListRowIndexAtPosition(view.outline, snapshot.viewportX, snapshot.viewportY);
		view.outline.hoverIndex = index; this.feedback.pointer(view, index, snapshot);
		if (index >= 0) pointerHover.visit(this); else pointerHover.release(this);
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && index >= 0) {
			if (this.select(index, false)) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		} else if (justPressed) {
			if (index >= 0) {
				const disclosure = workbenchTreeTwistieContainsPosition(view.outline, index, snapshot.viewportX);
				if (this.select(index, disclosure) && !disclosure)
					this.drag.begin(view.outline, view.outline.rows[view.outline.selectionIndex], snapshot, editorRuntimeState.currentTimeMs);
			}
			else this.focus();
		}
		return true;
	}
	private beginDrag(node: WorkbenchTreeNode<SceneOutlineElement>) {
		const view = this.view, revision = this.attachmentRevision, generation = this.inputScope.contextGeneration;
		if (!this.focusTarget.hasFocus) return;
		this.feedback.clear();
		return beginSceneHierarchyDrag(view, node, () => {
			if (this.viewValue !== view || revision !== this.attachmentRevision || generation !== this.inputScope.contextGeneration) return;
			view.refresh(); this.revealSelection(); this.update();
		});
	}
	public onPointerLeave(): void { if (this.hasView) this.view.outline.hoverIndex = -1; this.feedback.onPointerLeave(); }
	public handleWheel(event: WheelInputSnapshot): boolean {
		if (!this.hasView || !workbenchListContainsPosition(this.view.outline, event.viewportX, event.viewportY)) return false;
		const view = this.view, scroll = view.outline.scroll;
		scrollWorkbenchList(view.outline, event.deltaY * 3);
		if (scroll !== view.outline.scroll) view.notifyPresentationChanged();
		return true;
	}
	private openContextMenu(x: number, y: number, keyboard = false): void {
		const view = this.view, version = view.authoring.workingCopy.version, intent = view.authoring.selectionRevision;
		this.feedback.clear();
		this.contextMenu.show(x, y, this.contextActions, this.commands, {
			selectFirst: keyboard, invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.commandTarget,
			onWillShow: lifetime => {
				lifetime.add({ dispose: view.authoring.workingCopy.onDidChangeContent(() => this.contextMenu.hide()) });
				lifetime.add({ dispose: view.authoring.onDidChangeSelection(() => this.contextMenu.hide()) });
				lifetime.add({ dispose: this.inputScope.onDidRetireContext(() => this.contextMenu.hide(false)) });
				if (this.viewValue !== view || view.authoring.workingCopy.version !== version || view.authoring.selectionRevision !== intent) this.contextMenu.hide(false);
			},
		});
	}
	public clearView(): void { this.attachmentRevision++; this.detach(); }
	private detach(): void {
		if (!this.hasView) return;
		const revision = this.attachmentRevision;
		this.attachmentLifetime.dispose(); this.viewValue = undefined; this.presented = false;
		this.drag.cancel();
		pointerHover.release(this); this.feedback.clear();
		this.inputScope.retireContext();
		if (revision === this.attachmentRevision) this.focusTarget.release();
	}
	public dispose(): void {
		if (this.hasView) this.clearView();
		pointerHover.release(this); this.feedback.dispose(); this.drag.dispose(); this.unbindKeyboard(); this.unbindBlur();
	}
}

const TREE_NAVIGATION = [
	['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end'],
] as const;
