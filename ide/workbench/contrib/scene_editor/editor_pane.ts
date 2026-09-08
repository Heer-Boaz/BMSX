import { point_in_rect } from '../../../../machine/ts/common/rect';
import { clamp } from '../../../../machine/ts/common/clamp';
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
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { updateWorkbenchActionBarPointer } from '../../input/pointer/action_bar';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { SceneEditorController } from './controller';
import { POSITION_AXES, type SceneEditorInput } from './editor_input';
import { drawSceneEditor, layoutSceneEditor } from './render';

/** Concrete editable view: document history here, draft history in each field. */
export class SceneEditorPane extends FullWidthWorkbenchEditorPane<SceneEditorInput> {
	public readonly controls: readonly IntegerInput[];
	private status = '';
	private boundVersion = 0;

	public constructor(resourcePanel: ResourcePanelController,
		private readonly controller: SceneEditorController,
		private readonly commands: IdeCommandController,
		private readonly sources: RuntimeSourceState,
		clipboard: Clipboard,
	) {
		super(resourcePanel);
		this.controls = POSITION_AXES.map((_axis, index) => new IntegerInput(this.focusTarget, clipboard, value => {
			const property = this.input.properties[index];
			this.input.workingCopy.pushEditOperations(createLuaTableFieldIntegerEdits(this.input.workingCopy.buffer, property.field!, value)!);
		}));
		this.focusTarget.registerCommand('undo', {
			isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canUndo,
			run: () => { this.input.workingCopy.undo(); },
		});
		this.focusTarget.registerCommand('redo', {
			isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canRedo,
			run: () => { this.input.workingCopy.redo(); },
		});
	}

	protected override activate(): void {
		super.activate();
		this.controller.refresh(this.input);
		this.bindProperties();
		layoutSceneEditor(this.input, true);
	}

	public override update(): void {
		this.controller.refresh(this.input);
		const changed = this.boundVersion !== this.input.version;
		if (changed) this.bindProperties();
		layoutSceneEditor(this.input, changed);
		this.status = SOURCE_STATUS[getTextFileRuntimeSourceStatus(this.sources, this.input.workingCopy)];
	}

	public draw(): void { drawSceneEditor(this.input, this.controls, this.commands); }

	private bindProperties(): void {
		let previous = this.focusTarget;
		this.focusTarget.next = null;
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
		if (previous !== this.focusTarget) {
			previous.next = this.focusTarget;
			this.focusTarget.previous = previous;
		}
		this.boundVersion = this.input.version;
	}

	private select(index: number): void {
		this.focus();
		this.controller.refresh(this.input);
		this.controller.select(this.input, index);
		this.bindProperties();
		revealWorkbenchListSelection(this.input.members);
		layoutSceneEditor(this.input, true);
	}

	public handleKeyboard(input: PlayerInput): void {
		const members = this.input.members;
		for (const [code, delta] of MEMBER_NAVIGATION) {
			if (shouldRepeatKeyFromPlayer(code, input)) {
				consumeIdeKey(code, input);
				if (members.rows.length > 0) this.select(clamp(members.selectionIndex + delta, 0, members.rows.length - 1));
				return;
			}
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.focusTarget.next !== null) this.focusTarget.next.focus();
		}
	}

	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
		const command = updateWorkbenchActionBarPointer(this.input.actionBar, snapshot);
		if (command !== null) {
			if (justPressed && this.commands.isEnabled(command)) this.commands.execute(command);
			return true;
		}
		for (let index = 0; index < this.controls.length; index += 1) {
			const control = this.controls[index];
			const bounds = this.input.properties[index].bounds;
			if (!control.field.readOnly && (point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds) || control.field.pointerSelecting)) {
				control.handlePointer(bounds.left + 3, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				return true;
			}
		}
		const index = workbenchListRowIndexAtPosition(this.input.members, snapshot.viewportX, snapshot.viewportY);
		this.input.members.hoverIndex = index;
		if (justPressed) {
			if (index >= 0) this.select(index);
			else this.focus();
		}
		return index >= 0;
	}

	public handleWheel(direction: number, steps: number, _pointer: PointerSnapshot | null, input: PlayerInput): void {
		scrollWorkbenchList(this.input.members, direction * steps * 3);
		input.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}

	public drawStatusBar(top: number, color: number): void {
		api.blit_text_inline_with_font(this.status, 4, top + 2, 0, color, editorViewState.font.renderFont());
	}

	public override dispose(): void {
		for (const control of this.controls) control.dispose();
		super.dispose();
	}
}

const MEMBER_NAVIGATION = [['ArrowUp', -1], ['ArrowDown', 1]] as const;
const SOURCE_STATUS = {
	applied: 'SOURCE APPLIED', pending: 'SOURCE NOT APPLIED', failed: 'SOURCE APPLY FAILED',
	untracked: 'SOURCE STATUS UNKNOWN', source_only: 'SOURCE ONLY',
};
