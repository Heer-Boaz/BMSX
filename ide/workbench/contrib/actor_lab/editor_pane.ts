import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { drawWorkbenchSplit } from '../../render/split_view';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import { COLOR_TAB_BORDER } from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { layoutGameFrame } from '../../common/game_frame';
import { drawEditorText } from '../../../editor/render/text_renderer';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
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
import { actorDetailsPropertiesEqual, actorDetailsPropertyMatchesSelection, captureActorDetailsSelection, type ActorDetailsProperty } from './details';
import { ActorLabController } from './controller';
import type { ActorLabInput } from './editor_input';
import type { ActorNode } from './runtime';
import { drawActorLab } from './render';
import { GameInputControl } from '../game_view/game_input';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import type { ActorStateGraph } from './state_graph';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { ActorLabNavigationSelection } from './navigation_selection';
import type { ActorViewportHit } from './viewport_pick';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { WorkbenchTooltip } from '../../ui/tooltip';

export class ActorLabEditorPane extends FullWidthWorkbenchEditorPane<ActorLabInput> {
	private gameInput!: GameInputControl;
	private controller!: ActorLabController;
	private readonly actions: WorkbenchActionBarControl;
	private readonly actionTooltip = new WorkbenchTooltip();
	private readonly timelineSlider: WorkbenchSliderControl;
	private readonly scrub = (node: ActorNode, time: number, program: number, current: () => boolean, finished: (completed: boolean) => void) =>
		this.controller.scrub(this.input, node, time, program, current, finished);
	private timelineVisible = false;
	private splitRevision = -1;
	private restoreDetailsScroll = false;
	private navigationSelection: ActorLabNavigationSelection | undefined;
	private renderedTopology = -1;
	private viewportHover = false;
	private pointerX = 0;
	private pointerY = 0;
	private viewportHit: ActorViewportHit | undefined;
	private readonly split = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	public inspector!: WorkbenchPropertyInspector<ActorDetailsProperty>;
	public detailsWindow!: WorkbenchFloatingWindow;
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover, player => this.handleGraphKeyboard(player), this.focusTarget);
	private boundGraph: ActorStateGraph | undefined;
	public constructor(resourcePanel: ResourcePanelController, private readonly commands: EditorCommandRunner,
		private readonly contextMenu: ContextMenuController, private readonly surfaces: WorkbenchSurfaceService,
		private readonly paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>) {
		super(resourcePanel);
		this.focusTarget.scope.surfaceScope = paneSurface.captureScope;
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus());
		this.timelineSlider = new WorkbenchSliderControl(inputFocus, pointerCapture, this.focusTarget,
			value => this.input.timeline.request(value), () => this.input.timeline.cancelPending());
		this.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.timelineSlider.focusTarget.previous = this.actions.focusTarget;
		this.split.focusTarget.commandContext = this.focusTarget;
		this.timelineSlider.focusTarget.commandContext = this.focusTarget;
		for (const target of [this.focusTarget, this.graph.focusTarget]) {
			this.bindTransportCommands(target);
			target.registerCommand('actorLab.follow', {
				isEnabled: () => this.input.follow.target !== undefined || this.controller.selected(this.input) !== undefined,
				run: () => {
					if (this.input.follow.target !== undefined) this.input.follow.stop();
					else this.input.follow.start(this.controller.activityScope(this.input)!);
					this.update();
				},
			});
			target.registerCommand('actorLab.revealActive', {
				isEnabled: () => this.controller.selected(this.input) !== undefined,
				run: () => { this.input.follow.pending = this.controller.activityScope(this.input); this.update(); },
			});
			target.registerCommand('actorLab.more', {
				isEnabled: () => true,
				run: () => {
					const bar = this.input.presentation === 'outline' ? this.input.actionBar : this.input.stateGraphActions;
					const bounds = bar.items.find(item => item.command === 'actorLab.more')!.bounds;
					this.contextMenu.show(bounds.left, bounds.bottom, WORKBENCH_MENUS['actorLab.context'], this.commands, { selectFirst: true, invocationOrigin: target, commandTarget: target,
						onWillShow: lifetime => lifetime.add({ dispose: this.controller.guest.onDidInvalidate(() => this.contextMenu.hide()) }),
					});
				},
			});
			target.registerCommand('actorLab.select', { isEnabled: () => true, run: () => this.controller.selectActor(this.input) });
			target.registerCommand('actorLab.find', {
				isEnabled: () => this.input.actorPresent && !this.input.dirty,
				run: () => this.controller.findMember(this.input, () => { this.update(); this.focus(); }),
			});
			target.registerCommand('actorLab.spawn', { isEnabled: () => this.controller.canInteract(), run: () => this.controller.spawn(this.input) });
			target.registerCommand('actorLab.emit', { isEnabled: () => this.controller.canInteract() && this.input.actorPresent && !this.input.dirty, run: () => this.controller.emitEvent(this.input) });
			target.registerCommand('actorLab.actions', { isEnabled: () => this.controller.canInteract() && this.controller.hasActions(this.input), run: () => this.controller.actions(this.input) });
			target.registerCommand('actorLab.call', { isEnabled: () => this.controller.canInteract() && this.controller.selected(this.input) !== undefined, run: () => this.controller.callMethod(this.input) });
			target.registerCommand('actorLab.details', { isEnabled: () => this.input.detailsWindow.open || this.input.details!.subject !== undefined
				|| this.controller.selected(this.input) !== undefined, run: () => {
				this.showDetails(true);
			} });
			target.registerCommand('actorLab.stateGraph', {
				isEnabled: () => { const kind = this.controller.selected(this.input)?.kind; return this.input.presentation === 'outline' && (kind === 'machine' || kind === 'state'); },
				run: () => {
					const selectionChanged = this.controller.openStateGraph(this.input, editorViewState.font.renderFont()); this.update();
					const view = this.input.stateGraph!.viewport;
					if (selectionChanged && this.input.follow.target === undefined && view.selection !== null) view.reveal(view.selection);
					this.graph.focusTarget.focus();
				},
			});
			target.registerCommand('actorLab.outline', { isEnabled: () => this.input.presentation === 'graph',
				run: () => { this.controller.openOutline(this.input); this.update(); this.focus(); } });
		}
	}
	private bindTransportCommands(target: InputFocusTarget): void {
		target.registerCommand('actorLab.playback', {
			isEnabled: () => this.controller.viewport.transport.playbackEnabled,
			run: () => { this.input.running = this.controller.viewport.transport.togglePlayback(); },
		});
		target.registerCommand('pause', {
			isEnabled: () => this.controller.viewport.transport.playbackEnabled,
			run: () => { this.input.running = this.controller.viewport.transport.togglePlayback(); },
		});
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) target.registerCommand(command, {
			isEnabled: () => this.controller.viewport.transport.navigation.canStep(direction),
			run: () => { this.input.running = false; this.controller.viewport.transport.navigation.step(direction); },
		});
	}
	private createDetailsWindow(): void {
		const input = this.input;
		this.detailsWindow = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, this.surfaces, this.commands, {
			model: input.detailsWindow, actionBar: input.detailsActions, lifetimeOwner: this.paneSurface,
			focusReturn: this.focusTarget, workArea: this.workArea,
			getTitleTooltip: () => input.details!.title,
			content: {
				draw: () => drawWorkbenchPropertyInspector(this.inspector),
				handlePointer: snapshot => { this.inspector.handlePointer(snapshot); },
				handleWheel: event => this.inspector.handleWheel(event, event.deltaY * editorViewState.lineHeight * 3),
			},
			layoutContent: bounds => this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, bounds),
			retireContentInput: () => this.inspector.hide(),
			restoreContentInput: () => {
				this.controller.inspect(input, this.inspector, false, this.focusTarget);
				this.inspector.attachFeedback(this.surfaces, this.detailsWindow.clientSurface!, this.workArea);
				this.restoreDetailsScroll = true;
			},
			focusContent: () => this.inspector.focusTarget.focus(),
		});
		this.inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.detailsWindow.clientFocusTarget, 'client');
		this.inspector.setFocusOrder(this.detailsWindow.actionFocusTarget, this.detailsWindow.focusTarget);
		this.inspector.onContextMenu = (x, y, keyboard) => {
			input.running = false;
			this.contextMenu.show(x, y, WORKBENCH_MENUS['actorLab.property.context'], this.commands, { selectFirst: keyboard, commandTarget: this.inspector.focusTarget,
				onWillShow: lifetime => lifetime.add({ dispose: this.controller.guest.onDidInvalidate(() => this.contextMenu.hide()) }),
			});
		};
		for (const target of [this.detailsWindow.focusTarget, this.inspector.focusTarget]) {
			this.bindTransportCommands(target);
			for (const command of ['actorLab.select', 'actorLab.find'] as const) {
				target.registerCommand(command, this.focusTarget.getCommand(command)!);
			}
			target.registerCommand('actorLab.lockDetails', {
				isEnabled: () => input.details!.subject !== undefined,
				run: () => { this.controller.setDetailsLocked(input, !input.details!.locked); this.update(); },
			});
			target.registerCommand('actorLab.details', { isEnabled: () => input.detailsWindow.open, run: () => this.showDetails(true) });
		}
		for (const command of ['window.collapse', 'window.hide'] as const) {
			this.inspector.focusTarget.registerCommand(command, this.detailsWindow.focusTarget.getCommand(command)!);
		}
		for (const [command, enabled, execute] of [
			['actorLab.pinProperty', ActorLabController.prototype.canPinProperty, ActorLabController.prototype.pinProperty],
			['actorLab.unpinProperty', ActorLabController.prototype.canUnpinProperty, ActorLabController.prototype.unpinProperty],
			['actorLab.revealPinnedProperty', ActorLabController.prototype.canRevealPinnedProperty, ActorLabController.prototype.revealPinnedProperty],
		] as const) this.inspector.focusTarget.registerCommand(command, {
			isEnabled: () => {
				const item = this.inspector.model.rows[this.inspector.model.selectionIndex]?.element;
				return this.inspector.visible && item !== undefined && enabled.call(this.controller, input, item);
			},
			run: () => {
				const item = this.inspector.model.rows[this.inspector.model.selectionIndex].element;
				execute.call(this.controller, input, item); this.update();
				const selection = this.inspector.model.rows.findIndex(row => actorDetailsPropertyMatchesSelection(row.element, input.detailsSelection));
				if (selection >= 0) this.inspector.model.select(selection);
				this.inspector.focusTarget.focus();
			},
		});
	}
	private initializeDetailsPlacement(): void {
		const input = this.input, model = input.detailsWindow, font = editorViewState.font.renderFont();
		const minimumWidth = editorViewState.charAdvance * 32 + 12, minimumHeight = font.lineHeight * 7 + 16;
		model.setMinimumSize(minimumWidth, minimumHeight);
		if (input.detailsPlacementInitialized) return;
		const area = this.workArea, preview = input.previewBounds;
		const width = Math.max(minimumWidth, (area.right - area.left) / 2);
		const height = Math.max(minimumHeight, (area.bottom - area.top) / 2);
		model.setRequestedBounds({ left: preview.right - 4 - width, top: preview.bottom - 4 - height,
			right: preview.right - 4, bottom: preview.bottom - 4 });
		input.detailsPlacementInitialized = true;
	}
	private updateDetailsWindow(): void {
		const input = this.input, model = input.detailsWindow, details = input.details!;
		if (!model.open) { this.controller.followDetailsSelection(input); this.detailsWindow.detach(); return; }
		this.initializeDetailsPlacement();
		const attached = this.detailsWindow.visible;
		if (!attached) this.detailsWindow.show(false);
		if (!model.collapsed && attached) {
			const items = this.controller.refreshDetails(input);
			if (items !== undefined) this.inspector.updateItems(items, actorDetailsPropertiesEqual);
		} else if (model.collapsed) this.controller.followDetailsSelection(input);
		model.title = details.caption;
		const lock = input.detailsActions.items.find(item => item.command === 'actorLab.lockDetails')!;
		if (lock.checked !== details.locked) { lock.checked = details.locked; model.invalidate(); }
		this.detailsWindow.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		if (!model.collapsed) this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, model.client);
		if (this.restoreDetailsScroll && this.inspector.visible) {
			this.inspector.model.viewport.scrollbar.setScroll(input.detailsScroll);
			this.restoreDetailsScroll = false;
		}
		this.detailsWindow.update();
	}
	public override get suspendsRuntime(): boolean { return !this.input.running; }
	public override get showsGameFrame(): boolean { return true; }
	public override get runtimeTransport() { return this.runtimeControlContext === undefined ? undefined : this.controller.viewport.transport; }
	public override get runtimeControlContext() { return this.input.presentation === 'outline' ? this.focusTarget : this.graph.focusTarget; }
	public override setRuntimeCaptureRunning(running: boolean): void { this.input.running = running; }
	public override focus(): void {
		if (this.boundGraph === undefined) super.focus();
		else this.graph.focusTarget.focus();
	}
	public override getSelection(): ActorLabNavigationSelection {
		if (this.inspector.visible) {
			const selected = this.inspector.model.rows[this.inspector.model.selectionIndex]?.element;
			this.input.detailsSelection = selected === undefined ? undefined : captureActorDetailsSelection(selected);
			this.input.detailsScroll = this.inspector.model.viewport.scrollTop;
		}
		return this.controller.captureSelection(this.input);
	}
	protected override activate(): void {
		this.controller = this.input.controller;
		this.gameInput = new GameInputControl(this.focusTarget, this.controller.viewport.recipient, this.controller.viewport);
		super.activate();
		this.createDetailsWindow();
		this.renderedTopology = -1;
		this.actionTooltip.attach(this.surfaces, this.paneSurface, this.workArea);
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.split.setInput(this.input.split);
		this.timelineSlider.setInput(this.input.timeline.slider);
		if (this.controller.viewport.kind === 'direct' || this.controller.viewport.frames.bitmap !== undefined) this.gameInput.setInput(this.input.previewBounds);
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: ActorLabNavigationSelection): void {
		if (navigationSelection === undefined) return;
		this.detailsWindow.detach();
		this.controller.restoreSelection(this.input, navigationSelection, editorViewState.font.renderFont());
		this.navigationSelection = navigationSelection;
		this.renderedTopology = -1;
	}
	public override clearInput(): void {
		pointerHover.release(this);
		this.navigationSelection = undefined;
		this.actionTooltip.detach();
		this.detailsWindow.dispose(); this.inspector.dispose(); this.gameInput.dispose(); this.actions.clearInput();
		this.graph.clearInput(); this.boundGraph = undefined;
		this.focusTarget.commandContext = this.focusTarget;
		this.split.focusTarget.commandContext = this.focusTarget;
		this.timelineSlider.focusTarget.commandContext = this.focusTarget;
		this.split.clearInput();
		// Detaching is not execution; the controller still observes guest invalidation while hidden.
		this.timelineSlider.clearInput(); this.input.timeline.clear(); this.input.running = false; this.scrollbar.cancelPointer(); super.clearInput();
	}
	public override dispose(): void {
		if (this.hasInput) this.clearInput();
		pointerHover.release(this); this.actions.dispose(); this.graph.dispose(); this.split.dispose(); this.timelineSlider.dispose(); this.scrollbar.cancelPointer(); super.dispose();
	}
	public override update(): void {
		const input = this.input;
		if (this.controller.viewport.kind === 'direct' || this.controller.viewport.frames.bitmap !== undefined) this.gameInput.setInput(input.previewBounds);
		else this.gameInput.clearInput();
		const readback = input.dirty;
		const revealed = this.controller.refresh(input);
		// Controller commands can reconcile before paint; the pane consumes the revision independently.
		const contentsChanged = revealed || this.renderedTopology !== input.runtime.topologyRevision;
		this.renderedTopology = input.runtime.topologyRevision;
		const visibleGraph = input.presentation === 'graph' ? input.stateGraph : undefined;
		const graphChanged = this.boundGraph !== visibleGraph;
		if (graphChanged) {
			this.boundGraph = visibleGraph;
			if (this.boundGraph === undefined) this.graph.clearInput(); else this.graph.setInput(this.boundGraph.viewport);
			const context = this.boundGraph === undefined ? this.focusTarget : this.graph.focusTarget;
			this.focusTarget.commandContext = context;
			this.split.focusTarget.commandContext = context;
			this.timelineSlider.focusTarget.commandContext = context;
			this.actions.setInput(input.presentation === 'outline' ? input.actionBar : input.stateGraphActions, context);
		}
		this.boundGraph?.layout(editorViewState.font.renderFont());
		const layoutChanged = updateFullWidthWorkbenchLayout(input.layout, this.contentBounds);
		if (!this.timelineSlider.focusTarget.hasFocus) input.timeline.cancelPending();
		input.timeline.refresh(this.controller.selected(input), input.running, this.controller.guest, readback, this.controller.canInteract());
		const timelineChanged = this.timelineVisible !== input.timeline.visible;
		this.timelineVisible = input.timeline.visible;
		const { layout, outline } = input;
		const bar = input.presentation === 'outline' ? input.actionBar : input.stateGraphActions;
		const follow = bar.items.find(item => item.command === 'actorLab.follow')!;
		const followLabel = input.follow.target === undefined ? 'Follow' : 'Unfollow';
		const followChanged = follow.label !== followLabel;
		follow.label = followLabel;
		follow.checked = input.follow.target !== undefined;
		if (this.timelineVisible) input.timelineLayout.update(input.timeline, layout);
		const viewportChanged = layoutChanged || timelineChanged || graphChanged || this.splitRevision !== input.split.revision;
		if (viewportChanged && input.follow.target !== undefined) input.follow.pending = input.follow.target;
		if (followChanged || contentsChanged || viewportChanged) {
			this.updateContentLayout();
			layoutWorkbenchActionBar(input.presentation === 'outline' ? input.actionBar : input.stateGraphActions, input.split.position - 4,
				layout.top + 2, layout.top + layout.rowHeight + 8, measureText, editorViewState.font.renderFont(), layout.left + 4);
			if (input.presentation === 'graph') input.stateGraph!.titleLabel = truncateTextToWidth(input.stateGraph!.title, input.split.position - layout.left - 16);
			for (const row of outline.rows) row.element.displayLabel = truncateTextToWidth(row.element.label,
				outline.layout.contentRight - outline.layout.contentLeft - (row.depth + 2) * outline.layout.indentWidth - 4, 'middle');
		}
		this.updateViewportHit();
		this.controller.layoutNavigation(input);
		this.timelineSlider.update();
		if (input.presentation === 'graph') this.graph.update();
		this.actions.focusTarget.next = input.timeline.slider.interactive ? this.timelineSlider.focusTarget : this.split.focusTarget;
		this.timelineSlider.focusTarget.next = this.split.focusTarget;
		this.split.focusTarget.previous = input.timeline.slider.interactive ? this.timelineSlider.focusTarget : this.actions.focusTarget;
		const next = input.presentation === 'outline' ? this.gameInput.focusTarget : this.graph.focusTarget;
		this.split.focusTarget.next = next;
		next.previous = this.split.focusTarget;
		this.graph.focusTarget.next = this.gameInput.focusTarget;
		this.gameInput.focusTarget.previous = input.presentation === 'outline' ? this.split.focusTarget : this.graph.focusTarget;
		this.gameInput.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.gameInput.focusTarget;
		this.updateDetailsWindow();
		input.timeline.executePending(this.controller.selected(input), this.controller.canInteract(), this.scrub);
		this.actions.update();
		const tooltipItem = this.actions.tooltipItem;
		if (tooltipItem !== undefined) this.actionTooltip.show(tooltipItem.tooltip, tooltipItem.bounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
		this.inspector.update();
		// The host publishes this pane's transport-aware bounds before update, not activation.
		this.navigationSelection?.restoreViewport(input);
		this.navigationSelection = undefined;
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		drawEditorText(editorViewState.font, this.detailsWindow.hasFocus ? this.input.details!.title
			: this.split.focusTarget.hasFocus ? 'RESIZE PANES: LEFT/RIGHT | HOME: RESET'
			: this.viewportHit !== undefined ? this.viewportHit.label
			: this.controller.selected(this.input)?.label ?? this.input.status, bounds.left + 4, bounds.top + 2, 0, color);
	}
	public draw(): void {
		drawActorLab(this.input, this.timelineSlider.focusTarget.hasFocus, this.graph.hover, this.graph.focusTarget.hasFocus, this.controller.viewport);
		const hit = this.viewportHit;
		if (hit !== undefined) {
			const bounds = this.input.previewBounds, size = this.controller.viewport.presenter.offscreenCanvasSize;
			const scaleX = (bounds.right - bounds.left) / size.x, scaleY = (bounds.bottom - bounds.top) / size.y;
			api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
			api.blit_rect(bounds.left + hit.left * scaleX, bounds.top + hit.top * scaleY,
				bounds.left + hit.right * scaleX, bounds.top + hit.bottom * scaleY, 0, COLOR_TAB_BORDER);
			api.popClipRect();
		}
		this.gameInput.draw();
		drawWorkbenchSplit(this.input.split, this.split.hovered || this.split.focusTarget.hasFocus);
	}
	private showDetails(focus: boolean): void {
		updateFullWidthWorkbenchLayout(this.input.layout, this.contentBounds);
		this.updateContentLayout();
		const attached = this.detailsWindow.visible;
		this.input.detailsWindow.open = true;
		this.updateDetailsWindow();
		if (attached) this.surfaces.raise(this.detailsWindow.surface!);
		if (focus) {
			if (this.input.detailsWindow.collapsed) this.detailsWindow.focusTarget.focus();
			else this.inspector.focusTarget.focus();
		}
	}
	public onPointerLeave(): void {
		this.viewportHover = false; this.viewportHit = undefined;
	}
	private updateViewportHit(): void {
		if (!this.viewportHover) return;
		const bounds = this.input.previewBounds;
		if (this.controller.rewind.seeking || this.controller.viewport.presenter.gameFrameSequence === undefined
			|| !point_in_rect(this.pointerX, this.pointerY, bounds)) { pointerHover.release(this); return; }
		const size = this.controller.viewport.presenter.offscreenCanvasSize;
		this.viewportHit = this.controller.viewportPicker.pick(this.input.domain,
			(this.pointerX - bounds.left) * size.x / (bounds.right - bounds.left),
			(this.pointerY - bounds.top) * size.y / (bounds.bottom - bounds.top));
	}

	public handleKeyboard(input: KeyInputEvent): void {
		if (!this.input.actorPresent) return;
		if (this.input.presentation === 'graph') { this.handleGraphKeyboard(input); return; }
		for (const [key, command] of NAVIGATION) {
			if (!isKeyDown(key, input)) continue;
			consumeIdeKey(key, input);
			this.input.follow.stop();
			navigateWorkbenchTree(this.input.outline, command);
			this.input.rememberSelection();
			this.updateContentLayout();
			return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.commands.execute('actorLab.details'); }
	}
	private updateContentLayout(): void {
		const { layout } = this.input;
		const top = layout.top + 2;
		const bottom = layout.bottom - (this.input.timeline.visible ? this.input.timelineLayout.height : 0);
		this.input.split.layout(layout.left, top, layout.right, bottom);
		this.splitRevision = this.input.split.revision;
		const divider = this.input.split.position;
		const previewLeft = divider + 6;
		layoutGameFrame(this.input.previewBounds, previewLeft, top, layout.right - 4, bottom - 4);
		const treeTop = top + layout.rowHeight + 9;
		this.input.outline.updateLayout(layout.left + 4, treeTop, divider, bottom,
			layout.rowHeight + 4, Math.max(editorViewState.font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2));
		this.boundGraph?.viewport.layout(layout.left + 4, treeTop + layout.rowHeight + 4, divider, bottom);
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.previewBounds)) {
			if (!this.controller.rewind.seeking) {
				this.viewportHover = true; this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY; pointerHover.visit(this);
				if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && !this.gameInput.focusTarget.hasFocus) {
					this.updateViewportHit();
					if (this.viewportHit !== undefined) {
						this.controller.inspectActor(this.input, this.viewportHit.domain, this.viewportHit.hashId); this.update(); this.focus(); return true;
					}
				}
			}
			this.gameInput.handlePointer(snapshot);
			return false;
		}
		if (this.split.handlePointer(snapshot) || this.actions.handlePointer(snapshot) || this.input.timeline.visible && this.timelineSlider.handlePointer(snapshot)) return true;
		if (!this.input.actorPresent) return false;
		if (this.input.presentation === 'outline' && this.scrollbar.handlePointer(snapshot, this.input.outline.scrollbar)) {
			if (justPressed) this.input.follow.stop();
			return true;
		}
		if (this.input.presentation === 'graph') {
			const result = this.graph.handlePointer(snapshot, now);
			if (snapshot.justPressedButtons !== 0 && result !== WorkbenchGraphPointerResult.Outside) this.input.follow.stop();
			if (result === WorkbenchGraphPointerResult.Selection || result === WorkbenchGraphPointerResult.Activate || result === WorkbenchGraphPointerResult.ContextMenu) this.input.stateGraph!.rememberSelection();
			if (result === WorkbenchGraphPointerResult.Activate) this.commands.execute('actorLab.details');
			else if (result === WorkbenchGraphPointerResult.ContextMenu) {
				this.input.running = false;
				this.contextMenu.show(snapshot.viewportX, snapshot.viewportY, WORKBENCH_MENUS['actorLab.context'], this.commands, { selectFirst: false, commandTarget: this.graph.focusTarget,
					onWillShow: lifetime => lifetime.add({ dispose: this.controller.guest.onDidInvalidate(() => this.contextMenu.hide()) }),
				});
			}
			return result !== WorkbenchGraphPointerResult.Outside;
		}
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		const index = workbenchListRowIndexAtPosition(this.input.outline, snapshot.viewportX, snapshot.viewportY);
		if (index < 0) return false;
		if (justPressed || (snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			this.focus();
			this.input.follow.stop();
			this.input.outline.selectionIndex = index;
			this.input.rememberSelection();
			if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
				this.input.running = false;
				this.contextMenu.show(snapshot.viewportX, snapshot.viewportY, WORKBENCH_MENUS['actorLab.context'], this.commands, { selectFirst: false, commandTarget: this.focusTarget,
					onWillShow: lifetime => lifetime.add({ dispose: this.controller.guest.onDidInvalidate(() => this.contextMenu.hide()) }),
				});
			} else if (workbenchTreeTwistieContainsPosition(this.input.outline, index, snapshot.viewportX)) {
				const node = this.input.outline.rows[index];
				setWorkbenchTreeCollapsed(this.input.outline, index, !node.collapsed);
				this.updateContentLayout();
			}
		}
		return true;
	}
	public handleWheel(event: WheelInputSnapshot): void {
		if (this.input.presentation === 'graph') {
			if (!this.graph.handleWheel(event)) return;
		} else {
			if (!workbenchListContainsPosition(this.input.outline, event.viewportX, event.viewportY)) return;
			scrollWorkbenchList(this.input.outline, event.deltaY * 3);
		}
		this.input.follow.stop();
	}

	private handleGraphKeyboard(player: KeyInputEvent): void {
		const view = this.input.stateGraph!.viewport;
		if (isKeyJustPressed('Escape', player)) { consumeIdeKey('Escape', player); this.commands.execute('actorLab.outline'); return; }
		if (isKeyJustPressed('Enter', player)) { consumeIdeKey('Enter', player); this.commands.execute('actorLab.details'); return; }
		for (const [key, direction] of GRAPH_SELECTION_KEYS) {
			if (!isKeyDown(key, player)) continue;
			consumeIdeKey(key, player); this.input.follow.stop(); view.selectRelative(direction);
			this.input.stateGraph!.rememberSelection();
			if (view.selection !== null) view.reveal(view.selection);
			return;
		}
		for (const [key, x, y] of GRAPH_PAN_KEYS) {
			if (isKeyDown(key, player)) { consumeIdeKey(key, player); this.input.follow.stop(); view.pan(x, y); return; }
		}
		if (isKeyDown('Home', player) && view.selection !== null) { consumeIdeKey('Home', player); this.input.follow.stop(); view.reveal(view.selection); }
	}
}

const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
const GRAPH_SELECTION_KEYS = [['ArrowUp', -1], ['ArrowDown', 1]] as const;
const GRAPH_PAN_KEYS = [['ArrowLeft', -16, 0], ['ArrowRight', 16, 0], ['PageUp', 0, -64], ['PageDown', 0, 64]] as const;
