import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchPropertyEdit } from '../../ui/property_edit';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { workbenchListRowIndexAtPosition, scrollWorkbenchList, revealWorkbenchListSelection } from '../../ui/list_view';
import { navigateWorkbenchTree } from '../../ui/tree_view';
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import type { AnimationTrackSource } from './model';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { AnimationEditorController } from './controller';
import type { AnimationEditorInput } from './editor_input';
import { AnimationKeyControl } from './key_control';
import { layoutAnimationEditor } from './layout';
import { drawAnimationEditor } from './render';

const TRACK_NAVIGATION = [['ArrowUp', -1], ['ArrowDown', 1]] as const;
const DETAILS_NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['Home', 'home'], ['End', 'end']] as const;

export class AnimationEditorPane extends FullWidthWorkbenchEditorPane<AnimationEditorInput> {
	private readonly actions: WorkbenchActionBarControl;
	private readonly propertyPointer = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly detailsFocus = inputFocus.createTarget(this.focusTarget);
	private readonly edit = new WorkbenchPropertyEdit<LuaFieldValueEdit>(this.detailsFocus, value => value.edit.text);
	private readonly keys: AnimationKeyControl;
	private readonly unbindDetailsKeyboard: () => void;
	private unbindProjection: (() => void) | undefined;
	private version = -1;
	private font: typeof editorViewState.font | undefined;
	private keyTrack: AnimationTrackSource | undefined;
	private hasKeys = false;
	private left = 0; private top = 0; private right = 0; private bottom = 0;
	public constructor(resources: ResourcePanelController, private readonly controller: AnimationEditorController,
		private readonly commands: IdeCommandController, private readonly contextMenu: ContextMenuController) {
		super(resources);
		this.keys = new AnimationKeyControl(this.focusTarget, controller);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.detailsFocus.commandContext = this.focusTarget;
		this.unbindDetailsKeyboard = this.detailsFocus.bindKeyboard(player => this.handleDetailsKeyboard(player));
		this.focusTarget.registerCommand('animation.addTrack', { isEnabled: () => this.controller.canAddTrack(this.input), run: () => this.controller.addTrack(this.input) });
		this.focusTarget.registerCommand('animation.addKey', { isEnabled: () => this.controller.canAddKey(this.input), run: () => this.controller.addKey(this.input) });
		this.focusTarget.registerCommand('animation.remove', { isEnabled: () => this.controller.canRemove(this.input), run: () => this.controller.remove(this.input) });
		this.focusTarget.registerCommand('animation.source', { isEnabled: () => true, run: () => this.controller.openSource(this.input) });
		this.focusTarget.registerCommand('animation.producerSource', {
			isEnabled: () => this.input.details.rows[this.input.details.selectionIndex]?.element.producer !== undefined,
			run: () => this.controller.openProducerSource(this.input),
		});
		this.focusTarget.registerCommand('animation.edit', { isEnabled: () => {
			const property = this.input.details.rows[this.input.details.selectionIndex]?.element;
			if (property === undefined || !property.source.structural || !this.input.document!.syntaxComplete) return false;
			const range = property.source.file.chunk.locations.range(property.field.value.span);
			return range.start.line === range.end.line && !this.controller.modelFor(this.input, property.source.file).readOnly;
		}, run: () => this.editProperty() });
		this.focusTarget.registerCommand('animation.more', { isEnabled: () => true, run: () => {
			const bounds = this.input.actionBar.items.find(item => item.command === 'animation.more')!.bounds;
			this.contextMenu.show(bounds.left, bounds.bottom, WORKBENCH_MENUS['animation.context'], commands, true);
		} });
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			isEnabled: () => { const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction); return model !== undefined && !model.readOnly; },
			run: () => executeTextHistoryCommand(this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction)!, direction),
		});
		this.focusTarget.next = this.keys.focusTarget; this.keys.focusTarget.previous = this.focusTarget;
		this.keys.focusTarget.next = this.detailsFocus; this.detailsFocus.previous = this.keys.focusTarget;
		this.detailsFocus.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.detailsFocus;
		this.actions.focusTarget.next = this.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
	}
	protected override activate(): void {
		super.activate(); this.actions.setInput(this.input.actionBar, this.focusTarget); this.keys.setInput(this.input);
		this.unbindProjection = this.input.onDidInvalidateProjection(() => this.edit.close()); this.version = -1; this.update();
	}
	public override clearInput(): void {
		this.unbindProjection?.(); this.unbindProjection = undefined; this.edit.close(); this.keys.clearInput(); this.actions.clearInput();
		this.propertyPointer.clear(); this.detailsFocus.release(); super.clearInput();
	}
	public override dispose(): void {
		this.unbindProjection?.(); this.keys.dispose(); this.actions.dispose(); this.edit.dispose(); this.unbindDetailsKeyboard();
		this.propertyPointer.clear(); super.dispose();
	}
	private editProperty(): void {
		const row = this.input.details.rows[this.input.details.selectionIndex], property = row.element;
		const model = this.controller.modelFor(this.input, property.source.file), locations = property.source.file.chunk.locations;
		const valueRange = locations.range(property.field.value.span), range = luaSourceRangeToTextRange(model.buffer, valueRange);
		this.edit.open({ model, tree: this.input.details, row, parse: text => parseLuaFieldValueEdit(model.buffer, locations, property.field, text),
			apply: value => model.pushEditOperations([value.edit]) }, { edit: { offset: range.start, deleteLength: range.end - range.start, text: readLuaSourceRange(model.buffer, valueRange) },
			fieldRange: locations.range(property.field.span), expressionRange: valueRange });
	}
	public override update(): void {
		this.controller.refresh(this.input);
		const bounds = this.contentBounds;
		const hasKeys = this.input.keys.track !== undefined;
		if (this.version !== this.input.version || this.hasKeys !== hasKeys || this.font !== editorViewState.font || this.left !== bounds.left || this.top !== bounds.top || this.right !== bounds.right || this.bottom !== bounds.bottom) {
			layoutAnimationEditor(this.input, bounds, this.keys);
			this.input.keys.endLabelWidth = measureText(this.input.keys.endLabel);
			this.keyTrack = this.input.keys.track;
			this.hasKeys = hasKeys;
			this.version = this.input.version; this.font = editorViewState.font;
			this.left = bounds.left; this.top = bounds.top; this.right = bounds.right; this.bottom = bounds.bottom;
		}
		if (this.keyTrack !== this.input.keys.track) {
			this.keyTrack = this.input.keys.track;
			this.input.keys.endLabelWidth = measureText(this.input.keys.endLabel);
		}
		const details = this.input.details.layout;
		layoutWorkbenchPropertyTree(this.input.details, editorViewState.font.renderFont(), measureTextRange,
			details.contentLeft, details.contentTop, details.contentRight, details.bottom);
		this.edit.update(); this.actions.update();
	}
	public draw(): void { drawAnimationEditor(this.input, this.contentBounds, this.keys.focusTarget.hasFocus); if (this.edit.active) this.edit.draw(); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { drawEditorText(editorViewState.font, this.input.status, bounds.left + 4, bounds.top + 2, 0, color); }
	public handleKeyboard(player: PlayerInput): void {
		for (const [key, delta] of TRACK_NAVIGATION) {
			if (!shouldRepeatKeyFromPlayer(key, player)) continue;
			consumeIdeKey(key, player);
			const list = this.input.tracks, index = Math.max(0, Math.min(list.rows.length - 1, list.selectionIndex + delta));
			if (list.rows.length !== 0) { this.controller.selectTrack(this.input, index); revealWorkbenchListSelection(list); }
			return;
		}
		if (isKeyJustPressed('Delete', player)) { consumeIdeKey('Delete', player); this.commands.execute('animation.remove'); }
	}
	private handleDetailsKeyboard(player: PlayerInput): void {
		for (const [key, command] of DETAILS_NAVIGATION) {
			if (shouldRepeatKeyFromPlayer(key, player)) { consumeIdeKey(key, player); navigateWorkbenchTree(this.input.details, command); return; }
		}
		if (isKeyJustPressed('Enter', player)) { consumeIdeKey('Enter', player); this.commands.execute('animation.edit'); }
	}
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean, now: number): boolean {
		if (this.edit.handlePointer(snapshot) || this.actions.handlePointer(snapshot) || this.keys.handlePointer(snapshot)) return true;
		const result = this.propertyPointer.handle(this.input.details, snapshot, justPressed, now);
		if (result !== WorkbenchPropertyPointerResult.Outside) {
			if (justPressed) this.detailsFocus.focus();
			if (result === WorkbenchPropertyPointerResult.Activate) this.commands.execute('animation.edit');
			return true;
		}
		const index = workbenchListRowIndexAtPosition(this.input.tracks, snapshot.viewportX, snapshot.viewportY);
		if (index === -1) return false;
		if (justPressed) { this.focus(); this.controller.selectTrack(this.input, index); }
		return true;
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null, player: PlayerInput): void {
		if (pointer === null) return;
		const list = this.input.tracks, details = this.input.details;
		if (workbenchListRowIndexAtPosition(list, pointer.viewportX, pointer.viewportY) !== -1) scrollWorkbenchList(list, direction * steps * 3);
		else if (workbenchListRowIndexAtPosition(details, pointer.viewportX, pointer.viewportY) !== -1) scrollWorkbenchList(details, direction * steps * 3);
		else return;
		player.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}
}
