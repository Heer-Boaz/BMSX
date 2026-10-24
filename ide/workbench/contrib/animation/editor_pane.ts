import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchPropertyEdit } from '../../ui/property_edit';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { WorkbenchImageControl } from '../../ui/image_control';
import type { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { workbenchListRowIndexAtPosition, scrollWorkbenchList, revealWorkbenchListSelection } from '../../ui/list_view';
import { navigateWorkbenchTree } from '../../ui/tree_view';
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import type { AnimationTrackSource } from './model';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { AnimationEditorController } from './controller';
import type { AnimationEditorInput } from './editor_input';
import { AnimationKeyControl } from './key_control';
import { AnimationLaneControl } from './lane_control';
import { layoutAnimationEditor } from './layout';
import { drawAnimationEditor } from './render';
import { WorkbenchTooltip } from '../../ui/tooltip';

const TRACK_NAVIGATION = [['ArrowUp', -1], ['ArrowDown', 1]] as const;
const DETAILS_NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['Home', 'home'], ['End', 'end']] as const;

export class AnimationEditorPane extends FullWidthWorkbenchEditorPane<AnimationEditorInput> {
	private readonly actions: WorkbenchActionBarControl;
	private readonly actionTooltip = new WorkbenchTooltip();
	private readonly propertyPointer = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly detailsFocus = inputFocus.createTarget(this.focusTarget);
	private readonly edit: WorkbenchPropertyEdit<LuaFieldValueEdit>;
	private readonly keys: AnimationKeyControl;
	private readonly lanes: AnimationLaneControl;
	private readonly image = new WorkbenchImageControl(inputFocus, pointerCapture, this.focusTarget);
	private imageBitmap: HostBitmap | undefined;
	private readonly unbindDetailsKeyboard: () => void;
	private unbindProjection: (() => void) | undefined;
	private version = -1;
	private font: typeof editorViewState.font | undefined;
	private keyTrack: AnimationTrackSource | undefined;
	private keyRevision = -1;
	private left = 0; private top = 0; private right = 0; private bottom = 0;
	public constructor(resources: ResourcePanelController, private readonly controller: AnimationEditorController,
		private readonly commands: IdeCommandController, contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly getWorkArea: () => Readonly<RectBounds>) {
		super(resources);
		this.edit = new WorkbenchPropertyEdit(this.detailsFocus, value => value.edit.text, surfaces, paneSurface, getWorkArea);
		this.propertyPointer.attachFeedback(surfaces, paneSurface, getWorkArea, this.detailsFocus);
		this.keys = new AnimationKeyControl(this.focusTarget, controller, controller.authoring);
		this.lanes = new AnimationLaneControl(this.focusTarget, controller);
		this.actionTooltip.attach(surfaces, paneSurface, getWorkArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = lifetime => {
			this.keys.cancelPointer(); this.lanes.cancelPointer(); this.propertyPointer.hideFeedback(); this.actionTooltip.hide();
			lifetime.add({ dispose: this.input.onDidInvalidateProjection(() => contextMenu.hide()) });
		};
		this.detailsFocus.commandContext = this.focusTarget;
		this.unbindDetailsKeyboard = this.detailsFocus.bindKeyboard(player => this.handleDetailsKeyboard(player));
		this.focusTarget.registerCommand('animation.addTrack', { isEnabled: () => this.controller.authoring.canAddTrack(this.input), run: () => this.controller.authoring.addTrack(this.input) });
		this.focusTarget.registerCommand('animation.addKey', { isEnabled: () => this.controller.authoring.canAddKey(this.input), run: () => this.controller.authoring.addKey(this.input) });
		this.focusTarget.registerCommand('animation.addClip', { isEnabled: () => this.controller.authoring.canAddClip(this.input), run: () => this.controller.authoring.addClip(this.input) });
		this.focusTarget.registerCommand('animation.addFrame', { isEnabled: () => this.controller.authoring.canAddFrame(this.input), run: () => this.controller.authoring.addFrame(this.input) });
		this.focusTarget.registerCommand('animation.addProperty', { isEnabled: () => this.controller.authoring.canAddProperty(this.input), run: () => this.controller.authoring.addProperty(this.input) });
		this.focusTarget.registerCommand('animation.duplicate', { isEnabled: () => this.controller.authoring.canDuplicate(this.input), run: () => this.controller.authoring.duplicate(this.input) });
		this.focusTarget.registerCommand('animation.earlier', { isEnabled: () => this.controller.authoring.canReorder(this.input, -1), run: () => this.controller.authoring.reorder(this.input, -1) });
		this.focusTarget.registerCommand('animation.later', { isEnabled: () => this.controller.authoring.canReorder(this.input, 1), run: () => this.controller.authoring.reorder(this.input, 1) });
		this.focusTarget.registerCommand('animation.openClip', { isEnabled: () => this.input.document?.clips[this.input.clipIndex]?.sequence !== undefined, run: () => this.controller.openClip(this.input) });
		this.focusTarget.registerCommand('animation.fit', { isEnabled: () => this.input.keys.unit !== undefined, run: () => { this.input.keys.fit(); this.input.keys.curve.bind(this.input.keys); } });
		this.focusTarget.registerCommand('animation.snap', { isEnabled: () => this.input.keys.unit !== undefined, run: () => { this.input.keys.snap = !this.input.keys.snap; this.input.status = this.input.keys.snap ? 'Snap on' : 'Snap off'; } });
		this.focusTarget.registerCommand('animation.remove', { isEnabled: () => this.controller.authoring.canRemove(this.input), run: () => this.controller.authoring.remove(this.input) });
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
		this.focusTarget.registerCommand('animation.more', { isEnabled: () => this.input.actionBar.overflow!.button.visible, run: () => this.actions.openOverflow() });
		for (const direction of ['undo', 'redo'] as const) {
			const historyCommand = {
				isEnabled: () => { const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction); return model !== undefined && !model.readOnly; },
				run: () => executeTextHistoryCommand(this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction)!, direction),
			};
			this.focusTarget.registerCommand(direction, historyCommand);
			this.detailsFocus.registerCommand(direction, historyCommand);
			this.keys.focusTarget.registerCommand(direction, historyCommand);
			this.image.focusTarget.registerCommand(direction, historyCommand);
		}
		this.focusTarget.next = this.keys.focusTarget; this.keys.focusTarget.previous = this.focusTarget;
		this.keys.focusTarget.next = this.image.focusTarget; this.image.focusTarget.previous = this.keys.focusTarget;
		this.image.focusTarget.next = this.detailsFocus; this.detailsFocus.previous = this.image.focusTarget;
		this.detailsFocus.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.detailsFocus;
		this.actions.focusTarget.next = this.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
	}
	protected override activate(): void {
		super.activate(); this.actions.setInput(this.input.actionBar, this.focusTarget); this.keys.setInput(this.input); this.lanes.setInput(this.input);
		this.unbindProjection = this.input.onDidInvalidateProjection(() => this.edit.close()); this.version = -1; this.update();
	}
	public override clearInput(): void {
		this.unbindProjection?.(); this.unbindProjection = undefined; this.edit.close(); this.keys.clearInput(); this.lanes.clearInput(); this.actions.clearInput();
		this.image.clearInput(); this.imageBitmap = undefined;
		this.actionTooltip.hide();
		this.propertyPointer.clear(); this.detailsFocus.release(); super.clearInput();
	}
	public override dispose(): void {
		this.unbindProjection?.(); this.keys.dispose(); this.lanes.dispose(); this.image.dispose(); this.actions.dispose(); this.edit.dispose(); this.unbindDetailsKeyboard();
		this.propertyPointer.dispose(); super.dispose();
		this.actionTooltip.detach();
	}
	private editProperty(): void {
		this.propertyPointer.hideFeedback();
		const input = this.input, row = input.details.rows[input.details.selectionIndex], property = row.element;
		const model = this.controller.modelFor(input, property.source.file), locations = property.source.file.chunk.locations;
		const valueRange = locations.range(property.field.value.span), range = luaSourceRangeToTextRange(model.buffer, valueRange);
		this.edit.open({ model, tree: input.details, row, parse: text => parseLuaFieldValueEdit(model.buffer, locations, property.field, text),
			apply: value => { model.pushEditOperations([value.edit]); this.controller.refresh(input); } }, { edit: { offset: range.start, deleteLength: range.end - range.start, text: readLuaSourceRange(model.buffer, valueRange) },
			fieldRange: locations.range(property.field.span), expressionRange: valueRange });
	}
	public override update(): void {
		this.controller.refresh(this.input);
		const bounds = this.contentBounds;
		if (this.version !== this.input.version || this.font !== editorViewState.font || this.left !== bounds.left || this.top !== bounds.top || this.right !== bounds.right || this.bottom !== bounds.bottom) {
			this.lanes.cancelPointer();
			layoutAnimationEditor(this.input, bounds, this.keys);
			this.input.keys.endLabelWidth = measureText(this.input.keys.endLabel);
			this.keyTrack = this.input.keys.track;
			this.version = this.input.version; this.font = editorViewState.font;
			this.left = bounds.left; this.top = bounds.top; this.right = bounds.right; this.bottom = bounds.bottom;
		}
		if (this.keyTrack !== this.input.keys.track) {
			this.keyTrack = this.input.keys.track;
			this.input.keys.endLabelWidth = measureText(this.input.keys.endLabel);
		}
		if (this.keyRevision !== this.input.keys.revision) {
			this.keyRevision = this.input.keys.revision;
			this.input.keys.endLabelWidth = measureText(this.input.keys.endLabel);
		}
		this.input.keys.update(); this.input.keys.curve.update(this.input.keys);
		this.input.overview.update(this.input);
		const preview = this.input.framePreview;
		if (preview.bitmap !== this.imageBitmap) {
			this.imageBitmap = preview.bitmap;
			if (preview.bitmap === undefined) this.image.clearInput(); else this.image.setInput(preview.view);
		}
		if (preview.bitmap !== undefined) {
			const area = this.input.keys.curve.bounds;
			preview.view.layout(area.left, area.top + editorViewState.font.lineHeight + 4, area.right, area.bottom);
		}
		const details = this.input.details.layout;
		layoutWorkbenchPropertyTree(this.input.details, editorViewState.font.renderFont(), measureTextRange,
			details.contentLeft, details.contentTop, details.contentRight, details.bottom);
		this.propertyPointer.updateFeedback(this.input.details);
		this.edit.update(); this.actions.update();
		const hint = this.actions.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.getWorkArea());
		else this.actionTooltip.hide();
	}
	public draw(): void { drawAnimationEditor(this.input, this.contentBounds, this.keys.focusTarget.hasFocus); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { drawEditorText(editorViewState.font, this.input.status, bounds.left + 4, bounds.top + 2, 0, color); }
	public handleKeyboard(player: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', player)) { consumeIdeKey('Escape', player); this.lanes.cancelPointer(); return; }
		for (const [key, delta] of TRACK_NAVIGATION) {
			if (!isKeyDown(key, player)) continue;
			consumeIdeKey(key, player);
			this.keys.cancelPointer(); this.lanes.cancelPointer();
			const list = this.input.tracks, index = Math.max(0, Math.min(list.rows.length - 1, list.selectionIndex + delta));
			if (list.rows.length !== 0) { this.controller.selectTrack(this.input, index); revealWorkbenchListSelection(list); }
			return;
		}
		if (isKeyJustPressed('Delete', player)) { consumeIdeKey('Delete', player); this.lanes.cancelPointer(); this.commands.execute('animation.remove'); }
	}
	private handleDetailsKeyboard(player: KeyInputEvent): void {
		for (const [key, command] of DETAILS_NAVIGATION) {
			if (isKeyDown(key, player)) { consumeIdeKey(key, player); navigateWorkbenchTree(this.input.details, command); this.controller.selectProperty(this.input, this.input.details.selectionIndex); this.propertyPointer.keyboardSelection(this.input.details); return; }
		}
		if (isKeyJustPressed('Enter', player)) { consumeIdeKey('Enter', player); this.commands.execute('animation.edit'); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.imageBitmap !== undefined && this.image.handlePointer(snapshot)) return true;
		if (this.actions.handlePointer(snapshot) || this.keys.handlePointer(snapshot) || this.lanes.handlePointer(snapshot)) return true;
		const result = this.propertyPointer.handle(this.input.details, snapshot, justPressed, now);
		if (result !== WorkbenchPropertyPointerResult.Outside) {
			if (justPressed) { this.detailsFocus.focus(); this.controller.selectProperty(this.input, this.input.details.selectionIndex); }
			if (result === WorkbenchPropertyPointerResult.Activate) this.commands.execute('animation.edit');
			return true;
		}
		const index = workbenchListRowIndexAtPosition(this.input.tracks, snapshot.viewportX, snapshot.viewportY);
		if (index === -1) return false;
		if (justPressed) { this.focus(); this.controller.selectTrack(this.input, index); }
		return true;
	}
	public handleWheel(event: WheelInputSnapshot): void {
		if (this.imageBitmap !== undefined && this.image.handleWheel(event, 16)) return;
		const list = this.input.tracks, details = this.input.details;
		if (this.input.keys.unit !== undefined && (point_in_rect(event.viewportX, event.viewportY, this.input.overview.bounds)
			|| point_in_rect(event.viewportX, event.viewportY, this.input.keys.range.bounds) || point_in_rect(event.viewportX, event.viewportY, this.input.keys.curve.bounds))) {
			this.keys.cancelPointer(); this.lanes.cancelPointer(); this.input.keys.zoom(event.viewportX, 1.25 ** event.deltaY);
			return;
		}
		if (workbenchListRowIndexAtPosition(list, event.viewportX, event.viewportY) !== -1) scrollWorkbenchList(list, event.deltaY * 3);
		else if (workbenchListRowIndexAtPosition(details, event.viewportX, event.viewportY) !== -1) scrollWorkbenchList(details, event.deltaY * 3);
	}
}
