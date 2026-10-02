import { WorkbenchSplitControl } from '../../ui/split_control';
import { drawWorkbenchSplit } from '../../render/split_view';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { layoutGameFrame } from '../../common/game_frame';
import { drawEditorText } from '../../../editor/render/text_renderer';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import type { IdeCommandController } from '../../../commands/controller';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isCtrlDown, isShiftDown, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
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
import type { ActorNode } from './runtime';
import { drawActorLab } from './render';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import type { ActorStateGraph } from './state_graph';

export class ActorLabEditorPane extends FullWidthWorkbenchEditorPane<ActorLabInput> {
	private readonly actions: WorkbenchActionBarControl;
	private readonly timelineSlider: WorkbenchSliderControl;
	private readonly scrub = (node: ActorNode, time: number, program: number, current: () => boolean, finished: (completed: boolean) => void) =>
		this.controller.scrub(this.input, node, time, program, current, finished);
	private timelineVisible = false;
	private splitRevision = -1;
	private readonly split = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	private readonly inspector = new WorkbenchPropertyInspector<BehaviorInspectionProperty>(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover, player => this.handleGraphKeyboard(player), this.focusTarget);
	private boundGraph: ActorStateGraph | undefined;
	public constructor(resourcePanel: ResourcePanelController, private readonly controller: ActorLabController,
		private readonly commands: IdeCommandController, private readonly frameNavigation: RuntimeFrameNavigation, private readonly contextMenu: ContextMenuController) {
		super(resourcePanel);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.timelineSlider = new WorkbenchSliderControl(inputFocus, pointerCapture, this.focusTarget,
			value => this.input.timeline.request(value), () => this.input.timeline.cancelPending());
		this.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.timelineSlider.focusTarget.previous = this.actions.focusTarget;
		this.split.focusTarget.commandContext = this.focusTarget;
		this.timelineSlider.focusTarget.commandContext = this.focusTarget;
		for (const target of [this.focusTarget, this.graph.focusTarget]) {
			target.registerCommand('actorLab.playback', {
				isEnabled: () => commands.isEnabled('gameView.playback'),
				run: () => { this.input.running = commands.toggleGamePlayback(); },
			});
			target.registerCommand('pause', {
				isEnabled: () => commands.isEnabled('gameView.playback'),
				run: () => { this.input.running = commands.toggleGamePlayback(); },
			});
			target.registerCommand('runtime.pause', { isEnabled: () => true, run: () => { this.input.running = false; } });
			target.registerCommand('runtime.resume', { isEnabled: () => true, run: () => { this.input.running = true; } });
			for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) target.registerCommand(command, {
				isEnabled: () => this.frameNavigation.canStep(direction),
				run: () => { this.input.running = false; this.frameNavigation.step(direction); },
			});
			target.registerCommand('actorLab.select', { isEnabled: () => true, run: () => controller.selectActor(this.input) });
			target.registerCommand('actorLab.spawn', { isEnabled: controller.canInteract, run: () => controller.spawn(this.input) });
			target.registerCommand('actorLab.emit', { isEnabled: () => controller.canInteract() && this.input.actorHashId !== 0, run: () => controller.emitEvent(this.input) });
			target.registerCommand('actorLab.actions', { isEnabled: () => controller.canInteract() && controller.hasActions(this.input), run: () => controller.actions(this.input) });
			target.registerCommand('actorLab.call', { isEnabled: () => controller.canInteract() && controller.selected(this.input) !== undefined, run: () => controller.callMethod(this.input) });
			target.registerCommand('actorLab.details', { isEnabled: () => controller.selected(this.input) !== undefined, run: () => controller.inspect(this.input, this.inspector) });
			target.registerCommand('actorLab.stateGraph', {
				isEnabled: () => { const kind = controller.selected(this.input)?.kind; return this.input.stateGraph === undefined && !this.inspector.visible && (kind === 'machine' || kind === 'state'); },
				run: () => {
					controller.openStateGraph(this.input, editorViewState.font.renderFont()); this.update();
					const view = this.input.stateGraph!.viewport;
					view.selection = view.model.nodes[0];
					view.scrollX = -Math.round((view.bounds.right - view.bounds.left) / 2); view.scrollY = -8;
					this.graph.focusTarget.focus();
				},
			});
			target.registerCommand('actorLab.outline', { isEnabled: () => this.input.stateGraph !== undefined && !this.inspector.visible,
				run: () => { this.input.stateGraph = undefined; this.update(); this.focus(); } });
		}
	}
	public override get suspendsRuntime(): boolean { return !this.input.running; }
	public override get showsGameFrame(): boolean { return !this.inspector.visible; }
	public override get runtimeControlContext() { return this.input.stateGraph === undefined ? this.focusTarget : this.graph.focusTarget; }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.split.setInput(this.input.split);
		this.timelineSlider.setInput(this.input.timeline.slider);
		this.update();
	}
	public override clearInput(): void {
		this.inspector.hide(); this.actions.clearInput();
		this.graph.clearInput(); this.boundGraph = undefined;
		this.focusTarget.commandContext = this.focusTarget;
		this.split.focusTarget.commandContext = this.focusTarget;
		this.timelineSlider.focusTarget.commandContext = this.focusTarget;
		this.split.clearInput(); this.timelineSlider.clearInput(); this.input.timeline.clear(); this.input.running = false; this.input.invalidate(); this.scrollbar.cancelPointer(); super.clearInput();
	}
	public override dispose(): void { this.inspector.dispose(); this.actions.dispose(); this.graph.dispose(); this.split.dispose(); this.timelineSlider.dispose(); this.scrollbar.cancelPointer(); super.dispose(); }
	public override update(): void {
		const input = this.input;
		const readback = input.dirty;
		const contentsChanged = this.controller.refresh(input);
		const graphChanged = this.boundGraph !== input.stateGraph;
		if (graphChanged) {
			this.boundGraph = input.stateGraph;
			if (this.boundGraph === undefined) this.graph.clearInput(); else this.graph.setInput(this.boundGraph.viewport);
			const context = this.boundGraph === undefined ? this.focusTarget : this.graph.focusTarget;
			this.focusTarget.commandContext = context;
			this.split.focusTarget.commandContext = context;
			this.timelineSlider.focusTarget.commandContext = context;
			this.actions.setInput(input.stateGraph === undefined ? input.actionBar : input.stateGraphActions, context);
		}
		input.stateGraph?.layout(editorViewState.font.renderFont());
		const layoutChanged = updateFullWidthWorkbenchLayout(input.layout, this.contentBounds);
		if (!this.timelineSlider.focusTarget.hasFocus) input.timeline.cancelPending();
		input.timeline.refresh(this.controller.selected(input), input.running, this.controller.guest, readback, this.controller.canInteract());
		const timelineChanged = this.timelineVisible !== input.timeline.visible;
		this.timelineVisible = input.timeline.visible;
		const { layout, outline } = input;
		if (this.timelineVisible) input.timelineLayout.update(input.timeline, layout);
		if (contentsChanged || layoutChanged || timelineChanged || graphChanged || this.splitRevision !== input.split.revision) {
			this.updateContentLayout();
			layoutWorkbenchActionBar(input.stateGraph === undefined ? input.actionBar : input.stateGraphActions, layout.right - 4, layout.top, layout.top + layout.rowHeight + 4, measureText, editorViewState.font.renderFont());
			if (input.stateGraph !== undefined) input.stateGraph.titleLabel = truncateTextToWidth(input.stateGraph.title, input.stateGraphActions.items[0].bounds.left - 8);
			for (const row of outline.rows) row.element.displayLabel = truncateTextToWidth(row.element.node.label,
				outline.layout.contentRight - outline.layout.contentLeft - (row.depth + 2) * outline.layout.indentWidth - 4);
		}
		this.timelineSlider.update();
		if (input.stateGraph !== undefined) this.graph.update();
		this.actions.focusTarget.next = input.timeline.slider.interactive ? this.timelineSlider.focusTarget : this.split.focusTarget;
		this.timelineSlider.focusTarget.next = this.split.focusTarget;
		this.split.focusTarget.previous = input.timeline.slider.interactive ? this.timelineSlider.focusTarget : this.actions.focusTarget;
		this.split.focusTarget.next = input.stateGraph === undefined ? this.focusTarget : this.graph.focusTarget;
		this.split.focusTarget.next.previous = this.split.focusTarget;
		this.graph.focusTarget.next = this.actions.focusTarget;
		input.timeline.executePending(this.controller.selected(input), this.controller.canInteract(), this.scrub);
		this.actions.update();
		this.inspector.update();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		drawEditorText(editorViewState.font, this.split.focusTarget.hasFocus ? 'RESIZE PANES: LEFT/RIGHT | HOME: RESET'
			: this.controller.selected(this.input)?.label ?? this.input.status, bounds.left + 4, bounds.top + 2, 0, color);
	}
	public draw(): void {
		if (this.inspector.visible) {
			this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, this.input.layout);
			drawWorkbenchPropertyInspector(this.inspector);
		} else {
			drawActorLab(this.input, this.commands.gamePlaybackState, this.timelineSlider.focusTarget.hasFocus, this.graph.hover, this.graph.focusTarget.hasFocus);
			drawWorkbenchSplit(this.input.split, this.split.hovered || this.split.focusTarget.hasFocus);
		}
	}
	public handleKeyboard(input: PlayerInput): void {
		if (this.input.stateGraph !== undefined) { this.handleGraphKeyboard(input); return; }
		for (const [key, command] of NAVIGATION) {
			if (!shouldRepeatKeyFromPlayer(key, input)) continue;
			consumeIdeKey(key, input);
			navigateWorkbenchTree(this.input.outline, command);
			this.updateContentLayout();
			return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.commands.execute('actorLab.details'); }
	}
	private updateContentLayout(): void {
		const { layout } = this.input;
		const top = layout.top + layout.rowHeight + 7;
		const bottom = layout.bottom - (this.input.timeline.visible ? this.input.timelineLayout.height : 0);
		this.input.split.layout(layout.left, top, layout.right, bottom);
		this.splitRevision = this.input.split.revision;
		const divider = this.input.split.position;
		const previewLeft = divider + 6;
		const previewTop = top + layout.rowHeight + 4;
		layoutGameFrame(this.input.previewBounds, previewLeft, previewTop, layout.right - 4, bottom - 4);
		this.input.outline.updateLayout(4, top, divider, bottom,
			layout.rowHeight + 4, editorViewState.font.advance(' ') * 2);
		this.input.stateGraph?.viewport.layout(4, top + layout.rowHeight + 4, divider, bottom);
	}
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean, now: number): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.split.handlePointer(snapshot) || this.actions.handlePointer(snapshot) || this.input.timeline.visible && this.timelineSlider.handlePointer(snapshot)
			|| this.input.stateGraph === undefined && this.scrollbar.handlePointer(snapshot, this.input.outline.scrollbar)) return true;
		if (this.input.stateGraph !== undefined) {
			const result = this.graph.handlePointer(snapshot, now);
			if (result === WorkbenchGraphPointerResult.Activate) this.commands.execute('actorLab.details');
			else if (result === WorkbenchGraphPointerResult.ContextMenu) {
				this.input.running = false;
				const lifetime = this.contextMenu.show(snapshot.viewportX, snapshot.viewportY, WORKBENCH_MENUS['actorLab.context'], this.commands, false);
				lifetime.add({ dispose: this.controller.guest.onDidInvalidate(() => this.contextMenu.hide()) });
			}
			return result !== WorkbenchGraphPointerResult.Outside;
		}
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
				this.updateContentLayout();
			}
		}
		return true;
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null, input: PlayerInput): void {
		if (this.inspector.visible) {
			if (pointer === null || !this.inspector.handleWheel(pointer, direction * steps * editorViewState.lineHeight * 3)) return;
		} else if (this.input.stateGraph !== undefined) {
			const distance = direction * steps * 16, horizontal = isShiftDown(input);
			if (pointer === null || !this.graph.handleWheel(pointer, horizontal ? distance : 0, horizontal ? 0 : distance,
				isCtrlDown(input) ? -direction * steps : 0)) return;
		} else {
			if (pointer === null || !workbenchListContainsPosition(this.input.outline, pointer.viewportX, pointer.viewportY)) return;
			scrollWorkbenchList(this.input.outline, direction * steps * 3);
		}
		input.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}

	private handleGraphKeyboard(player: PlayerInput): void {
		const view = this.input.stateGraph!.viewport;
		if (isKeyJustPressed('Escape', player)) { consumeIdeKey('Escape', player); this.commands.execute('actorLab.outline'); return; }
		if (isKeyJustPressed('Enter', player)) { consumeIdeKey('Enter', player); this.commands.execute('actorLab.details'); return; }
		for (const [key, direction] of GRAPH_SELECTION_KEYS) {
			if (!shouldRepeatKeyFromPlayer(key, player)) continue;
			consumeIdeKey(key, player); view.selectRelative(direction);
			if (view.selection !== null) view.reveal(view.selection);
			return;
		}
		for (const [key, x, y] of GRAPH_PAN_KEYS) {
			if (shouldRepeatKeyFromPlayer(key, player)) { consumeIdeKey(key, player); view.pan(x, y); return; }
		}
		if (shouldRepeatKeyFromPlayer('Home', player) && view.selection !== null) { consumeIdeKey('Home', player); view.reveal(view.selection); }
	}
}

const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
const GRAPH_SELECTION_KEYS = [['ArrowUp', -1], ['ArrowDown', 1]] as const;
const GRAPH_PAN_KEYS = [['ArrowLeft', -16, 0], ['ArrowRight', 16, 0], ['PageUp', 0, -64], ['PageDown', 0, 64]] as const;
