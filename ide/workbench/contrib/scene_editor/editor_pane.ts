import { pointerHover } from '../../../input/pointer/hover';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { SceneEditorNavigationSelection } from './navigation_selection';
import { PointerButton } from '../../../input/pointer/buttons';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { Clipboard } from '../../../common/clipboard';
import type { PointerSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { IntegerInput } from '../../../editor/ui/inline/integer_input';
import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../../editor/ui/view/state';
import { createLuaTableFieldIntegerEdits } from '../../../language/lua/source_edits';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { clampWorkbenchListScroll, revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { SceneEditorController } from './controller';
import { POSITION_AXES, type SceneEditorInput } from './editor_input';
import { drawSceneEditor } from './render';
import { layoutSceneEditor } from './layout';
import { selectSceneOutlineRow } from './outline';

/** Concrete editable view: document history here, draft history in each field. */
export class SceneEditorPane extends FullWidthWorkbenchEditorPane<SceneEditorInput> {
	public override getSelection(): SceneEditorNavigationSelection {
		this.controller.refresh(this.input);
		return new SceneEditorNavigationSelection(this.input);
	}

	public readonly controls: readonly IntegerInput[];
	private status = '';
	private boundVersion = 0;
	private readonly actionBar: WorkbenchActionBarControl;
	private readonly details: WorkbenchScrollControl;
	private readonly unbindFieldFocus: readonly (() => void)[];

	public constructor(resourcePanel: ResourcePanelController,
		private readonly controller: SceneEditorController,
		private readonly commands: IdeCommandController,
		private readonly sources: RuntimeSourceState,
		clipboard: Clipboard,
	) {
		super(resourcePanel);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.details = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);
		this.details.focusTarget.commandContext = this.focusTarget;
		this.controls = POSITION_AXES.map((_axis, index) => new IntegerInput(this.focusTarget, clipboard, value => {
			const property = this.input.properties[index];
			this.input.workingCopy.pushEditOperations(createLuaTableFieldIntegerEdits(this.input.workingCopy.buffer, property.field!, value)!);
		}));
		this.unbindFieldFocus = this.controls.map((control, index) => control.field.focusTarget.onDidFocus(() => this.revealProperty(index)));
		this.focusTarget.registerCommand('undo', {
			isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canUndo,
			run: () => { this.input.workingCopy.undo(); },
		});
		this.focusTarget.registerCommand('redo', {
			isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canRedo,
			run: () => { this.input.workingCopy.redo(); },
		});
	}

	protected override activate(_selection?: EditorTextSelection, navigationSelection?: SceneEditorNavigationSelection): void {
		super.activate();
		this.actionBar.setInput(this.input.actionBar, this.focusTarget);
		this.details.setInput(this.input.details);
		this.controller.refresh(this.input);
		navigationSelection?.restore(this.input);
		this.bindProperties();
		layoutSceneEditor(this.input, true);
		if (navigationSelection !== undefined) {
			this.input.outline.scroll = navigationSelection.outlineScroll;
			clampWorkbenchListScroll(this.input.outline);
			this.input.details.scrollbar.setScroll(navigationSelection.detailsScroll);
			layoutSceneEditor(this.input, false);
		}
		this.details.lineStep = this.input.outline.layout.rowHeight;
	}

	public override update(): void {
		this.controller.refresh(this.input);
		const changed = this.boundVersion !== this.input.version;
		if (changed) this.bindProperties();
		this.actionBar.update();
		if (layoutSceneEditor(this.input, changed)) {
			this.details.lineStep = this.input.outline.layout.rowHeight;
			for (let index = 0; index < this.controls.length; index += 1) {
				if (this.controls[index].field.focusTarget.hasFocus) this.revealProperty(index);
			}
		}
		this.details.update();
		this.status = SOURCE_STATUS[getTextFileRuntimeSourceStatus(this.sources, this.input.workingCopy)];
	}

	public draw(): void { drawSceneEditor(this.input, this.controls, this.commands, this.details.focusTarget.hasFocus); }

	private revealProperty(index: number): void {
		const bounds = this.input.properties[index].contentBounds;
		this.input.details.scrollbar.reveal(bounds.top, bounds.bottom, 2);
		layoutSceneEditor(this.input, false);
	}

	private bindProperties(): void {
		let previous = this.focusTarget;
		// An empty scroll area is pointer-focusable but not a Tab stop. Its local
		// neighbours still belong to this input, never to the preceding member.
		this.details.focusTarget.previous = this.focusTarget;
		this.details.focusTarget.next = this.actionBar.focusTarget;
		if (this.input.outline.selectionIndex >= 0) {
			previous.next = this.details.focusTarget;
			previous = this.details.focusTarget;
		}
		this.focusTarget.previous = null;
		for (let index = 0; index < this.controls.length; index += 1) {
			const property = this.input.properties[index];
			const control = this.controls[index];
			control.field.readOnly = this.input.workingCopy.readOnly || property.value === null;
			if (property.value !== null) control.setValue(property.value);
			if (!control.field.readOnly) {
				previous.next = control.field.focusTarget;
				control.field.focusTarget.previous = previous;
				previous = control.field.focusTarget;
			}
		}
		previous.next = this.actionBar.focusTarget;
		this.actionBar.focusTarget.previous = previous;
		this.actionBar.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actionBar.focusTarget;
		this.boundVersion = this.input.version;
	}

	private select(index: number, toggle: boolean): void {
		this.focus();
		this.controller.refresh(this.input);
		if (toggle) setWorkbenchTreeCollapsed(this.input.outline, index, !this.input.outline.rows[index].collapsed);
		selectSceneOutlineRow(this.input, index);
		const contentChanged = this.boundVersion !== this.input.version;
		this.bindProperties();
		revealWorkbenchListSelection(this.input.outline);
		layoutSceneEditor(this.input, contentChanged, true);
	}

	public handleKeyboard(input: PlayerInput): void {
		for (const [code, command] of TREE_NAVIGATION) {
			if (shouldRepeatKeyFromPlayer(code, input)) {
				consumeIdeKey(code, input);
				if (navigateWorkbenchTree(this.input.outline, command) !== WorkbenchTreeNavigationResult.None) this.select(this.input.outline.selectionIndex, false);
				return;
			}
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.focusTarget.next !== null) this.focusTarget.next.focus();
		}
	}

	public onPointerLeave(): void {
		this.input.outline.hoverIndex = -1;
	}

	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.layout)) return false;
		if (this.actionBar.handlePointer(snapshot)) return true;
		for (let index = 0; index < this.controls.length; index += 1) {
			const control = this.controls[index];
			const bounds = this.input.properties[index].bounds;
			if (!control.field.readOnly && ((point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.details.bounds)
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) || control.field.pointerSelecting)) {
				control.handlePointer(bounds.left + 3, snapshot.viewportX, justPressed, ((snapshot.pressedButtons & PointerButton.Primary) !== 0));
				return true;
			}
		}
		if (this.details.handlePointer(snapshot)) return true;
		const index = workbenchListRowIndexAtPosition(this.input.outline, snapshot.viewportX, snapshot.viewportY);
		if (index >= 0) pointerHover.visit(this);
		else pointerHover.release(this);
		this.input.outline.hoverIndex = index;
		if (justPressed) {
			if (index >= 0) this.select(index, workbenchTreeTwistieContainsPosition(this.input.outline, index, snapshot.viewportX));
			else this.focus();
		}
		return index >= 0;
	}

	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null, input: PlayerInput): void {
		if (pointer === null) return;
		if (this.details.handleWheel(pointer, direction * steps * this.details.lineStep * 3)) {
			layoutSceneEditor(this.input, false);
			input.inputHandlers.pointer?.consumeButton('pointer_wheel');
		} else if (workbenchListContainsPosition(this.input.outline, pointer.viewportX, pointer.viewportY)) {
			scrollWorkbenchList(this.input.outline, direction * steps * 3);
			input.inputHandlers.pointer?.consumeButton('pointer_wheel');
		}
	}

	public drawStatusBar(top: number, color: number): void {
		api.blit_text_inline_with_font(this.status, 4, top + 2, 0, color, editorViewState.font.renderFont());
	}

	public override dispose(): void {
		pointerHover.release(this);
		this.actionBar.dispose();
		this.details.dispose();
		for (const unbind of this.unbindFieldFocus) unbind();
		for (const control of this.controls) control.dispose();
		super.dispose();
	}

	public override clearInput(): void {
		pointerHover.release(this);
		this.actionBar.clearInput();
		this.details.clearInput();
		super.clearInput();
	}
}

const TREE_NAVIGATION = [
	['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end'],
] as const;
const SOURCE_STATUS = {
	applied: 'SOURCE APPLIED', pending: 'SOURCE NOT APPLIED', failed: 'SOURCE APPLY FAILED',
	untracked: 'SOURCE STATUS UNKNOWN', source_only: 'SOURCE ONLY',
};
