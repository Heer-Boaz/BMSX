import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { drawEditorText } from '../../../editor/render/text_renderer';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition } from '../../ui/tree_view';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { WorkbenchSliderControl } from '../../ui/slider_control';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { BehaviorInspectionProperty } from '../behavior_lens/inspection';
import type { ActorLabController } from './controller';
import type { ActorLabInput } from './editor_input';
import { drawActorLab } from './render';

export class ActorLabEditorPane extends FullWidthWorkbenchEditorPane<ActorLabInput> {
	private readonly actions: WorkbenchActionBarControl;
	private readonly timelineSlider: WorkbenchSliderControl;
	private timelineVisible = false;
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	private readonly inspector = new WorkbenchPropertyInspector<BehaviorInspectionProperty>(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	public constructor(resourcePanel: ResourcePanelController, private readonly controller: ActorLabController,
		private readonly commands: IdeCommandController, private readonly contextMenu: ContextMenuController) {
		super(resourcePanel);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.timelineSlider = new WorkbenchSliderControl(inputFocus, pointerCapture, this.focusTarget,
			value => this.input.timeline.request(value), () => this.input.timeline.cancelPending());
		this.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.timelineSlider.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.registerCommand('actorLab.playback', { isEnabled: controller.canExecute, run: () => controller.togglePlayback(this.input) });
		this.focusTarget.registerCommand('actorLab.select', { isEnabled: () => true, run: () => controller.selectActor(this.input) });
		this.focusTarget.registerCommand('actorLab.spawn', { isEnabled: controller.canExecute, run: () => controller.spawn(this.input) });
		this.focusTarget.registerCommand('actorLab.emit', { isEnabled: () => controller.canExecute() && this.input.actorHashId !== 0, run: () => controller.emitEvent(this.input) });
		this.focusTarget.registerCommand('actorLab.actions', { isEnabled: () => controller.canExecute() && controller.hasActions(this.input), run: () => controller.actions(this.input) });
		this.focusTarget.registerCommand('actorLab.call', { isEnabled: () => controller.canExecute() && controller.selected(this.input) !== undefined, run: () => controller.callMethod(this.input) });
		this.focusTarget.registerCommand('actorLab.details', { isEnabled: () => controller.selected(this.input) !== undefined, run: () => controller.inspect(this.input, this.inspector) });
	}
	public override get suspendsRuntime(): boolean { return !this.input.running; }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.timelineSlider.setInput(this.input.timeline.slider);
		this.scrollbar.setInput(this.input.outline.scrollbar);
		this.update();
	}
	public override clearInput(): void { this.timelineSlider.clearInput(); this.input.timeline.clear(); this.input.running = false; this.input.invalidate(false); this.inspector.hide(); this.actions.clearInput(); this.scrollbar.clearInput(); super.clearInput(); }
	public override dispose(): void { this.timelineSlider.dispose(); this.inspector.dispose(); this.actions.dispose(); this.scrollbar.clearInput(); super.dispose(); }
	public override update(): void {
		const input = this.input;
		const readback = input.dirty;
		const contentsChanged = this.controller.refresh(input);
		const layoutChanged = updateFullWidthWorkbenchLayout(input.layout);
		if (!this.timelineSlider.focusTarget.hasFocus) input.timeline.cancelPending();
		input.timeline.refresh(this.controller.selected(input), input.running, this.controller.guest, readback, this.controller.canInteract());
		const timelineChanged = this.timelineVisible !== input.timeline.visible;
		this.timelineVisible = input.timeline.visible;
		const { layout, outline } = input;
		if (this.timelineVisible) input.timelineLayout.update(input.timeline, layout);
		if (contentsChanged || layoutChanged || timelineChanged) {
			this.updateScrollRange();
			layoutWorkbenchActionBar(input.actionBar, layout.right - 4, layout.top, layout.top + layout.rowHeight + 4, measureText);
			for (const row of outline.rows) row.element.displayLabel = truncateTextToWidth(row.element.label,
				outline.layout.contentRight - outline.layout.contentLeft - (row.depth + 2) * outline.layout.indentWidth - 4);
		}
		this.timelineSlider.update();
		this.actions.focusTarget.next = input.timeline.slider.interactive ? this.timelineSlider.focusTarget : null;
		input.timeline.executePending(this.controller.selected(input), input.domain, this.controller.guest, this.controller.canExecute(), this.controller.execute);
		this.actions.update();
		this.scrollbar.update();
		this.inspector.update();
	}
	public drawStatusBar(top: number, color: number): void {
		drawEditorText(editorViewState.font, this.input.status, 4, top + 2, 0, color);
	}
	public draw(): void {
		if (this.inspector.visible) {
			this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, this.input.layout);
			drawWorkbenchPropertyInspector(this.inspector);
		} else drawActorLab(this.input, this.commands, !this.controller.execution.paused, this.timelineSlider.focusTarget.hasFocus);
	}
	public handleKeyboard(input: PlayerInput): void {
		for (const [key, command] of NAVIGATION) {
			if (!shouldRepeatKeyFromPlayer(key, input)) continue;
			consumeIdeKey(key, input);
			navigateWorkbenchTree(this.input.outline, command);
			this.updateScrollRange();
			return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.commands.execute('actorLab.details'); }
	}
	private updateScrollRange(): void {
		const { layout } = this.input;
		this.input.outline.updateLayout(4, layout.top + layout.rowHeight + 7, layout.right, layout.bottom - (this.input.timeline.visible ? this.input.timelineLayout.height : 0),
			layout.rowHeight + 4, editorViewState.font.advance(' ') * 2);
	}
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.actions.handlePointer(snapshot) || this.input.timeline.visible && this.timelineSlider.handlePointer(snapshot)
			|| this.scrollbar.handlePointer(snapshot)) return true;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		const index = workbenchListRowIndexAtPosition(this.input.outline, snapshot.viewportX, snapshot.viewportY);
		if (index < 0) return false;
		if (justPressed || (snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			this.focus();
			this.input.outline.selectionIndex = index;
			if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
				this.input.running = false;
				const lifetime = this.contextMenu.show(snapshot.viewportX, snapshot.viewportY, WORKBENCH_MENUS['actorLab.context'], this.commands, false);
				lifetime.add({ dispose: this.controller.guest.onDidInvalidate(() => this.contextMenu.hide()) });
			} else if (workbenchTreeTwistieContainsPosition(this.input.outline, index, snapshot.viewportX)) {
				const node = this.input.outline.rows[index];
				setWorkbenchTreeCollapsed(this.input.outline, index, !node.collapsed);
				this.updateScrollRange();
			}
		}
		return true;
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null, input: PlayerInput): void {
		if (this.inspector.visible) {
			if (pointer === null || !this.inspector.handleWheel(pointer, direction * steps * editorViewState.lineHeight * 3)) return;
		} else {
			if (pointer === null || !workbenchListContainsPosition(this.input.outline, pointer.viewportX, pointer.viewportY)) return;
			scrollWorkbenchList(this.input.outline, direction * steps * 3);
		}
		input.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}
}

const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
