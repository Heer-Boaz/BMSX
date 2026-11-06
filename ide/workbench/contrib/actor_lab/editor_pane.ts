import { ActorWorldControl } from './world_control';
import { ActorOutlinerControl } from './outliner_control';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { EditorPaneClearReason } from '../../services/editor/editor_pane';
import { ActorLabEditorActions } from './actions';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { showEditorMessage } from '../../../common/feedback_state';
import { SceneLivePositionDrag } from '../scene_editor/live_drag';
import { WorkbenchSplitControl } from '../../ui/split_control';
import type { WorkbenchSashView } from '../../ui/split_view';
import { drawWorkbenchSplit } from '../../render/split_view';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import { clamp } from '../../../../machine/ts/common/clamp';
import { COLOR_TAB_BORDER } from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget, type InputFocusScope } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, WorkbenchTreeNavigationResult, workbenchTreeTwistieContainsPosition } from '../../ui/tree_view';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { WorkbenchSliderControl } from '../../ui/slider_control';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { actorDetailsPropertiesEqual, actorDetailsPropertyMatchesSelection, captureActorDetailsSelection, type ActorDetailsProperty } from './details';
import { ActorLabController } from './controller';
import type { ActorLabInput } from './editor_input';
import type { ActorNode } from './runtime';
import { drawActorLab } from './render';
import { layoutActorLab } from './layout';
import { GameInputControl } from '../game_view/game_input';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import type { ActorStateGraph } from './state_graph';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { ActorLabNavigationSelection } from './navigation_selection';
import type { ActorViewportHit } from './viewport_pick';
import type { ResourceDomain } from '../../../common/resource';
import { actorActions } from './operations';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import { WorkbenchTooltip } from '../../ui/tooltip';

export class ActorLabEditorPane extends WorkbenchViewEditorPane<ActorLabInput> {
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	public readonly actorActions: ActorLabEditorActions;
	private readonly worldControl: ActorWorldControl;
	private readonly outlinerControl: ActorOutlinerControl;
	private gameInput!: GameInputControl;
	private controller!: ActorLabController;
	private readonly actions: WorkbenchActionBarControl;
	private readonly actionTooltip = new WorkbenchTooltip();
	private readonly timelineSlider: WorkbenchSliderControl;
	private readonly scrub = (node: ActorNode, time: number, program: number, current: () => boolean, finished: (completed: boolean) => void) =>
		this.actorActions.scrub(this.input, node, time, program, current, finished);
	private timelineVisible = false;
	private boundSplit: WorkbenchSashView | undefined;
	private splitPosition: number | undefined;
	private restoreDetailsScroll = false;
	private navigationSelection: ActorLabNavigationSelection | undefined;
	private renderedTopology = -1;
	private renderedOutline = -1;
	private renderedOutliner = -1;
	private renderedPresentation: ActorLabInput['presentation'] | undefined;
	private viewportHover = false;
	private pointerX = 0;
	private pointerY = 0;
	private readonly positionDrag = new SceneLivePositionDrag();
	private get sourcePosition() {
		return this.hasInput ? this.controller.sceneAuthoring?.positions.find(this.input.domain, this.input.actorHashId) : undefined;
	}
	private viewportHit: ActorViewportHit | undefined;
	private readonly split = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	public inspector!: WorkbenchPropertyInspector<ActorDetailsProperty>;
	public detailsWindow!: WorkbenchFloatingWindow;
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover, player => this.handleGraphKeyboard(player), this.focusTarget,
		(x, y) => { if (this.acceptGraphSelection()) this.showInspectionContextMenu(x, y, this.graph.focusTarget, false); });
	private boundGraph: ActorStateGraph | undefined;
	private statusInput: ActorLabInput | undefined;
	private statusTopology = -1;
	private statusTarget: ActorStateGraph['selectedTarget'];
	private statusAvailable = false;
	private statusSelectionLabel: string | undefined;
	public constructor(private readonly commands: EditorCommandRunner,
		private readonly contextMenu: ContextMenuController, private readonly surfaces: WorkbenchSurfaceService,
		private readonly paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>, group: EditorGroupView, quickInput: QuickInputController, scope: InputFocusScope) {
		super(scope);
		this.graph.onWillNavigate = () => this.input.follow.stop();
		this.worldControl = new ActorWorldControl(this.focusTarget, commands, contextMenu, () => { this.updateContentLayout(); this.update(); },
			(x, y, domain, hashId, keyboard) => this.showActorContextMenu(x, y, domain, hashId, this.worldControl.focusTarget, keyboard));
		this.outlinerControl = new ActorOutlinerControl(this.focusTarget, commands, () => this.update(),
			(x, y, domain, hashId, keyboard) => this.showActorContextMenu(x, y, domain, hashId, this.outlinerControl.focusTarget, keyboard));
		this.bindTransportCommands(this.worldControl.focusTarget);
		this.bindTransportCommands(this.outlinerControl.focusTarget);
		this.actorActions = new ActorLabEditorActions(group, quickInput, this.focusTarget);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus());
		this.timelineSlider = new WorkbenchSliderControl(inputFocus, pointerCapture, this.focusTarget,
			value => this.input.timeline.request(value), () => this.input.timeline.cancelPending());
		this.bindTransportCommands(this.timelineSlider.focusTarget);
		this.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.timelineSlider.focusTarget.previous = this.actions.focusTarget;
		this.split.focusTarget.commandContext = this.focusTarget;
		this.timelineSlider.focusTarget.commandContext = this.focusTarget;
		for (const target of [this.focusTarget, this.graph.focusTarget]) {
			for (const command of ['undo', 'redo', 'save'] as const) {
				const enabled = () => {
					const binding = this.sourcePosition;
					return binding !== undefined && !binding.authoring.workingCopy.readOnly && (command === 'save'
						? this.controller.sceneAuthoring!.saves.canSave(binding.authoring.workingCopy)
						: command === 'undo' ? binding.authoring.workingCopy.canUndo : binding.authoring.workingCopy.canRedo);
				};
				target.registerCommand(command, { contextual: true, isEnabled: enabled,
					run: () => {
						const model = this.sourcePosition!.authoring.workingCopy;
						if (command === 'save') this.controller.sceneAuthoring!.save(model); else executeTextHistoryCommand(model, command);
					}, capture: () => {
						const binding = this.sourcePosition; if (binding === undefined) return;
						const context = target.scope.contextGeneration;
						const current = () => target.scope.contextGeneration === context && this.sourcePosition === binding;
						return { editScope: target.scope, isEnabled: () => current() && enabled(), run: () => {
							if (!current()) return;
							if (command === 'save') this.controller.sceneAuthoring!.save(binding.authoring.workingCopy);
							else executeTextHistoryCommand(binding.authoring.workingCopy, command);
						} };
					} });
			}
			this.bindTransportCommands(target);
			target.registerCommand('contextMenu', {
				isEnabled: () => this.hasInput && (this.input.presentation === 'world' ? this.input.worldOutliner.tree.selectionIndex !== -1
					: this.input.presentation === 'graph' || this.controller.selected(this.input) !== undefined),
				run: () => {
					const input = this.input;
					if (input.presentation === 'world') { this.outlinerControl.openContextMenu(); return; }
					let x: number, y: number;
					if (input.presentation === 'graph') {
						const view = input.stateGraph!.viewport, selected = view.selection;
						x = selected === null ? view.bounds.left : clamp(view.graphToViewportX(selected.bounds.left), view.bounds.left, view.bounds.right);
						y = selected === null ? view.bounds.top : clamp(view.graphToViewportY(selected.bounds.bottom), view.bounds.top, view.bounds.bottom);
					} else {
						const tree = input.outline;
						x = tree.layout.contentLeft;
						y = tree.layout.contentTop + Math.max(0, tree.selectionIndex - (tree.scroll | 0) + 1) * tree.layout.rowHeight;
					}
					this.showInspectionContextMenu(x, y, target, true);
				},
			});
			target.registerCommand('actorLab.follow', {
				isEnabled: () => this.hasInput && (this.input.follow.target !== undefined || this.controller.selected(this.input) !== undefined),
				isChecked: () => this.hasInput && this.input.follow.target !== undefined,
				run: () => {
					if (this.input.follow.target !== undefined) this.input.follow.stop();
					else this.input.follow.start(this.controller.activityScope(this.input)!);
					this.update();
				},
			});
			target.registerCommand('actorLab.revealActive', {
				isEnabled: () => this.hasInput && this.controller.selected(this.input) !== undefined,
				run: () => { this.input.follow.pending = this.controller.activityScope(this.input); this.update(); },
			});
			target.registerCommand('actorLab.select', { isEnabled: () => this.hasInput, run: () => this.actorActions.selectActor(this.input) });
			target.registerCommand('actorLab.editScene', {
				isEnabled: () => this.hasInput && this.controller.sceneAuthoring !== undefined && !this.controller.rewind.active
					&& this.controller.selected(this.input)?.kind === 'actor',
				run: () => this.actorActions.editScene(this.input),
			});
			target.registerCommand('actorLab.find', {
				isEnabled: () => this.hasInput && this.input.actorPresent && !this.input.dirty,
				run: () => this.actorActions.findMember(this.input, () => { this.update(); this.focus(); }),
			});
			target.registerCommand('actorLab.spawn', { isEnabled: () => this.hasInput && this.controller.canInteract(), run: () => this.actorActions.spawn(this.input) });
			target.registerCommand('actorLab.emit', { isEnabled: () => this.hasInput && this.controller.canInteract() && this.input.actorPresent && !this.input.dirty, run: () => this.actorActions.emitEvent(this.input) });
			target.registerCommand('actorLab.actions', { isEnabled: () => this.hasInput && this.controller.canInteract() && this.controller.hasActions(this.input), run: () => this.actorActions.actions(this.input, this.controller.selected(this.input)!) });
			target.registerCommand('actorLab.run', { isEnabled: () => {
				if (!this.hasInput || !this.controller.canInteract(this.input.domain)) return false;
				const node = this.controller.selected(this.input);
				if (node !== undefined) for (const action of actorActions(node)) if (action.playback) return true;
				return false;
			}, run: () => this.actorActions.play(this.input) });
			target.registerCommand('actorLab.call', { isEnabled: () => this.hasInput && this.controller.canInteract() && this.controller.selected(this.input) !== undefined, run: () => this.actorActions.callMethod(this.input, this.controller.selected(this.input)!) });
			target.registerCommand('actorLab.details', { isEnabled: () => this.hasInput && (this.input.detailsWindow.open || this.input.details!.subject !== undefined
				|| this.controller.selected(this.input) !== undefined), isChecked: () => this.hasInput && this.input.detailsWindow.open, run: () => {
				this.showDetails(true);
			} });
			target.registerCommand('actorLab.stateGraph', {
				isEnabled: () => { if (!this.hasInput) return false; const kind = this.controller.selected(this.input)?.kind; return this.input.presentation === 'outline' && (kind === 'machine' || kind === 'state'); },
				isChecked: () => this.hasInput && this.input.presentation === 'graph',
				run: () => {
					const selectionChanged = this.controller.openStateGraph(this.input, editorViewState.font.renderFont()); this.update();
					const view = this.input.stateGraph!.viewport;
					if (selectionChanged && this.input.follow.target === undefined && view.selection !== null) view.reveal(view.selection);
					this.graph.focusTarget.focus();
				},
			});
			target.registerCommand('actorLab.world', { isEnabled: () => this.hasInput && this.input.presentation !== 'world',
				isChecked: () => this.hasInput && this.input.presentation === 'world',
				run: () => { this.controller.openWorld(this.input); this.update(); this.outlinerControl.focusTarget.focus(); } });
			target.registerCommand('actorLab.outline', { isEnabled: () => this.hasInput && (this.input.presentation === 'graph' || this.input.presentation === 'world' && this.input.actorPresent),
				isChecked: () => this.hasInput && this.input.presentation === 'outline',
				run: () => { this.controller.openOutline(this.input); this.update(); this.focus(); } });
		}
		// A viewport hit and an Outliner row address the actor, independently of
		// the member retained in the inspection panel. Opening their menu is not
		// a request to erase that member selection.
		for (const target of [this.worldControl.focusTarget, this.outlinerControl.focusTarget]) {
			const available = () => this.hasInput && !this.input.dirty && this.input.actorPresent;
			for (const command of ['sceneViewport.frameSelection', 'actorLab.emit', 'actorLab.find'] as const)
				target.registerCommand(command, this.focusTarget.getCommand(command)!);
			target.registerCommand('actorLab.actions', { isEnabled: () => available() && this.controller.canInteract()
				&& actorActions(this.input.runtime.roots[0]).length > 0,
				run: () => this.actorActions.actions(this.input, this.input.runtime.roots[0]) });
			target.registerCommand('actorLab.call', { isEnabled: () => available() && this.controller.canInteract(),
				run: () => this.actorActions.callMethod(this.input, this.input.runtime.roots[0]) });
			target.registerCommand('actorLab.details', { isEnabled: available, isChecked: () => this.hasInput && this.input.detailsWindow.open, run: () => {
				this.controller.projection.reveal(this.input.runtime.roots[0]); this.update(); this.showDetails(true);
			} });
			target.registerCommand('actorLab.outline', { isEnabled: available, isChecked: () => this.hasInput && this.input.navigation === 'actor', run: () => {
				if (this.input.navigation === 'world') this.controller.openOutline(this.input);
				this.update(); this.focus();
			} });
			target.registerCommand('actorLab.editScene', { isEnabled: () => available() && this.controller.sceneAuthoring !== undefined && !this.controller.rewind.active,
				run: () => this.actorActions.editScene(this.input) });
		}
	}
	/** All actor surfaces carry the displayed identity; camera and member-panel
	 * presentation do not choose the subject of an actor command. */
	private showActorContextMenu(x: number, y: number, domain: ResourceDomain, hashId: number, target: InputFocusTarget, keyboard: boolean): void {
		const input = this.input, generation = target.scope.contextGeneration;
		if (this.controller.rewind.seeking || !target.focus()) return;
		if (this.input !== input || target.scope.contextGeneration !== generation || inputFocus.admittedTarget !== target) return;
		this.controller.inspectActor(input, domain, hashId);
		if (this.input !== input || target.scope.contextGeneration !== generation) return;
		this.update();
		if (target.scope.contextGeneration !== generation || inputFocus.admittedTarget !== target
			|| !input.actorPresent || input.domain !== domain || input.actorHashId !== hashId) return;
		this.contextMenu.show(x, y, WORKBENCH_MENUS['actorLab.world.context'], this.commands, {
			invocationOrigin: target, returnFocus: target, commandTarget: target, selectFirst: keyboard,
			onWillShow: lifetime => {
				lifetime.add({ dispose: input.onDidChangeSelection(() => this.contextMenu.hide()) });
				lifetime.add({ dispose: this.controller.guest.onDidInvalidate(reason => { if (reason !== 'execution') this.contextMenu.hide(); }) });
			},
		});
	}
	/** Inspection menus address the row/node, not its owning actor. The actor row
	 * itself uses the same actor commands as viewport hits and World rows. */
	private showInspectionContextMenu(x: number, y: number, target: InputFocusTarget, keyboard: boolean): void {
		const input = this.input, graph = input.presentation === 'graph' ? input.stateGraph : undefined;
		if (this.controller.selected(input)?.kind === 'actor') {
			this.showActorContextMenu(x, y, input.domain, input.actorHashId, target, keyboard); return;
		}
		const menu = graph === undefined ? 'actorLab.context' : graph.viewport.selection === null ? 'actorLab.canvas.context' : 'actorLab.stateGraph.context';
		this.contextMenu.show(x, y, WORKBENCH_MENUS[menu], this.commands,
			{ selectFirst: keyboard, invocationOrigin: target, commandTarget: this.commandTarget, onWillShow: lifetime => {
				const retire = () => this.contextMenu.hide();
				lifetime.add({ dispose: input.onDidChangeSelection(retire) });
				if (graph !== undefined) lifetime.add({ dispose: graph.onDidChangeSelection(retire) });
				lifetime.add({ dispose: this.controller.guest.onDidInvalidate(reason => { if (reason !== 'execution') retire(); }) });
			} });
	}
	private bindTransportCommands(target: InputFocusTarget): void {
		for (const command of ['actorLab.playback', 'pause'] as const) target.registerCommand(command, {
			contextual: true,
			isEnabled: () => this.hasInput && (this.controller.execution.canControl || this.controller.viewport.transport.playbackEnabled),
			isChecked: () => this.hasInput && (this.controller.execution.active === undefined
				? this.controller.viewport.transport.state === 'PAUSED' : this.controller.execution.paused),
			run: () => {
				const execution = this.controller.execution, operation = execution.active;
				if (operation !== undefined) {
					this.input.interaction.running = false;
					execution.setPaused(operation, !execution.paused);
				} else this.commands.execute('runtime.playback', target);
			},
		});
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) target.registerCommand(command, {
			contextual: true,
			isEnabled: () => this.hasInput && this.controller.viewport.transport.navigation.canStep(direction),
			run: () => { this.input.interaction.running = false; this.controller.viewport.transport.navigation.step(direction); },
		});
	}
	private createDetailsWindow(): void {
		const pane = this, input = this.input;
		this.detailsWindow = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, this.surfaces, this.commands, this.contextMenu, {
			model: input.detailsWindow, actionBar: input.detailsActions, lifetimeOwner: this.paneSurface,
			presentationParent: this.surfaces.windowContext(this.paneSurface),
			focusScope: this.focusTarget.scope, get focusReturn() { return pane.commandTarget; }, workArea: this.workArea,
			getTitleTooltip: () => input.details!.title,
			content: {
				draw: () => drawWorkbenchPropertyInspector(this.inspector),
				handlePointer: snapshot => { this.inspector.handlePointer(snapshot); },
				handleWheel: event => this.inspector.handleWheel(event, event.deltaY * editorViewState.lineHeight * 3),
			},
			layoutContent: bounds => this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, bounds),
			retireContentInput: () => this.inspector.hide(),
			restoreContentInput: () => {
				this.actorActions.inspect(input, this.inspector, false, this.focusTarget);
				this.inspector.attachFeedback(this.surfaces, this.detailsWindow.clientSurface!, this.workArea);
				this.restoreDetailsScroll = true;
			},
			focusContent: () => this.inspector.focusTarget.focus(),
		});
		this.inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.detailsWindow.clientFocusTarget, 'client');
		this.inspector.setFocusOrder(this.detailsWindow.actionFocusTarget, this.detailsWindow.focusTarget);
		this.inspector.onContextMenu = (x, y, keyboard) => {
			input.interaction.running = false;
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
				isChecked: () => input.details!.locked,
				run: () => { this.controller.setDetailsLocked(input, !input.details!.locked); this.update(); },
			});
			target.registerCommand('actorLab.details', { isEnabled: () => input.detailsWindow.open, isChecked: () => input.detailsWindow.open, run: () => this.showDetails(true) });
		}
		this.inspector.focusTarget.registerCommand('window.hide', this.detailsWindow.focusTarget.getCommand('window.hide')!);
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
		if (model.placementInitialized) return;
		const area = this.workArea;
		const width = Math.max(minimumWidth, (area.right - area.left) / 2);
		const height = Math.max(minimumHeight, (area.bottom - area.top) / 2);
		model.setRequestedBounds({ left: area.right - 4 - width, top: area.bottom - 4 - height,
			right: area.right - 4, bottom: area.bottom - 4 });
	}
	private updateDetailsWindow(): void {
		const input = this.input, model = input.detailsWindow, details = input.details!;
		if (!model.open) { this.controller.followDetailsSelection(input); this.detailsWindow.detach(); return; }
		this.initializeDetailsPlacement();
		const attached = this.detailsWindow.visible;
		if (!attached) this.detailsWindow.show(false);
		if (attached) {
			const items = this.controller.refreshDetails(input);
			if (items !== undefined) this.inspector.updateItems(items, actorDetailsPropertiesEqual);
		}
		model.title = details.caption;
		this.detailsWindow.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, model.client);
		if (this.restoreDetailsScroll && this.inspector.visible) {
			this.inspector.model.viewport.scrollbar.setScroll(input.detailsScroll);
			this.restoreDetailsScroll = false;
		}
		this.detailsWindow.update();
	}
	public override get commandTarget(): InputFocusTarget { return this.boundGraph === undefined ? this.focusTarget : this.graph.focusTarget; }
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
		this.input.interaction.setRuntime(this.controller.viewport.transport, this.input.interaction.running);
		this.focusTarget.scope.interaction = this.input.interaction;
		this.focusTarget.scope.runtime = { target: this.focusTarget, interaction: this.input.interaction };
		this.gameInput = new GameInputControl(this.focusTarget, this.controller.viewport.recipient, this.controller.viewport, this.input.interaction);
		this.bindTransportCommands(this.gameInput.focusTarget);
		this.createDetailsWindow();
		this.worldControl.setInput(this.input);
		this.outlinerControl.setInput(this.input);
		this.renderedTopology = -1;
		this.renderedPresentation = undefined;
		this.actionTooltip.attach(this.surfaces, this.paneSurface, this.workArea);
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.timelineSlider.setInput(this.input.timeline.slider);
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: ActorLabNavigationSelection): void {
		if (navigationSelection === undefined) return;
		this.detailsWindow.detach();
		this.controller.restoreSelection(this.input, navigationSelection, editorViewState.font.renderFont());
		this.navigationSelection = navigationSelection;
		this.renderedTopology = -1;
	}
	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void {
		pointerCapture.cancelTarget(this.positionDrag); this.worldControl.clearInput();
		this.outlinerControl.clearInput();
		if (reason !== 'move') this.input.interaction.setRuntime(null);
		pointerHover.release(this);
		this.navigationSelection = undefined;
		this.actionTooltip.detach();
		this.detailsWindow.dispose(); this.inspector.dispose(); this.gameInput.dispose(); this.actions.clearInput();
		this.graph.clearInput(); this.boundGraph = undefined;
		this.focusTarget.commandContext = this.focusTarget;
		this.split.focusTarget.commandContext = this.focusTarget;
		this.timelineSlider.focusTarget.commandContext = this.focusTarget;
		this.split.clearInput();
		this.boundSplit = undefined;
		// Detaching is not execution; the controller still observes guest invalidation while hidden.
		this.timelineSlider.clearInput(); this.input.timeline.clear(); this.scrollbar.cancelPointer(); super.clearInput(reason);
	}
	public override dispose(): void {
		if (this.hasInput) this.clearInput();
		pointerHover.release(this); this.actions.dispose(); this.graph.dispose(); this.split.dispose(); this.timelineSlider.dispose(); this.scrollbar.cancelPointer(); this.worldControl.dispose(); this.outlinerControl.dispose(); super.dispose();
	}
	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds);
		const changed = updateFullWidthWorkbenchLayout(this.input.layout, bounds);
		if (changed && this.input.follow.target !== undefined) this.input.follow.pending = this.input.follow.target;
		this.updateContentLayout();
	}
	public override update(): void {
		this.positionDrag.refresh();
		const input = this.input, scope = this.focusTarget.scope, context = scope.contextGeneration;
		const readback = input.dirty;
		const revealed = this.controller.refresh(input);
		if (scope.contextGeneration !== context) return;
		// Controller commands can reconcile before paint; the pane consumes the revision independently.
		const contentsChanged = revealed || this.renderedTopology !== input.runtime.topologyRevision
			|| this.renderedOutline !== input.outline.rowsRevision || this.renderedOutliner !== input.worldOutliner.tree.rowsRevision;
		this.renderedTopology = input.runtime.topologyRevision;
		this.renderedOutline = input.outline.rowsRevision; this.renderedOutliner = input.worldOutliner.tree.rowsRevision;
		const visibleGraph = input.presentation === 'graph' ? input.stateGraph : undefined;
		const bar = input.presentation === 'world' ? input.worldActions : input.presentation === 'outline' ? input.actionBar : input.stateGraphActions;
		const graphChanged = this.boundGraph !== visibleGraph;
		const presentationChanged = this.renderedPresentation !== input.presentation;
		this.renderedPresentation = input.presentation;
		if (graphChanged || presentationChanged) {
			this.boundGraph = visibleGraph;
			if (this.boundGraph === undefined) this.graph.clearInput(); else this.graph.setInput(this.boundGraph.viewport);
			const context = this.boundGraph === undefined ? this.focusTarget : this.graph.focusTarget;
			this.focusTarget.commandContext = context;
			this.split.focusTarget.commandContext = context;
			this.timelineSlider.focusTarget.commandContext = context;
			this.actions.setInput(bar, context);
		}
		this.boundGraph?.layout(editorViewState.font.renderFont());
		const layoutChanged = updateFullWidthWorkbenchLayout(input.layout, this.contentBounds);
		if (!this.timelineSlider.focusTarget.hasFocus) input.timeline.cancelPending();
		input.timeline.refresh(this.controller.inspected(input), input.interaction.running, this.controller.guest, readback, this.controller.canInteract());
		const timelineChanged = this.timelineVisible !== input.timeline.visible;
		this.timelineVisible = input.timeline.visible;
		const { layout } = input;
		const follow = bar.items.find(item => item.command === 'actorLab.follow');
		const followLabel = input.follow.target === undefined ? 'Follow' : 'Unfollow';
		const followChanged = follow !== undefined && follow.label !== followLabel;
		if (follow !== undefined) follow.label = followLabel;
		if (this.timelineVisible) input.timelineLayout.update(input.timeline, layout);
		const viewportChanged = layoutChanged || timelineChanged || presentationChanged || this.splitPosition !== input.layout.split?.position;
		if (viewportChanged && input.follow.target !== undefined) input.follow.pending = input.follow.target;
		if (followChanged || contentsChanged || viewportChanged) {
			if (!this.updateContentLayout()) return;
		} else if (!this.updatePreviewInput()) return;
		this.worldControl.update();
		this.worldControl.navigation.advance(editorRuntimeState.currentTimeMs);
		if (input.layout.previewVisible) input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
		this.updateViewportHit();
		this.controller.layoutNavigation(input);
		this.timelineSlider.update();
		if (visibleGraph !== undefined) this.graph.update();

		this.updateDetailsWindow();
		input.timeline.executePending(this.controller.inspected(input), this.controller.canInteract(), this.scrub);
		this.actions.update();
		const tooltipItem = this.worldControl.actions.tooltipItem ?? this.actions.tooltipItem;
		if (tooltipItem !== undefined) this.actionTooltip.show(tooltipItem.tooltip, tooltipItem.bounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
		this.inspector.update();
		// The host publishes this pane's transport-aware bounds before update, not activation.
		this.navigationSelection?.restoreViewport(input);
		this.navigationSelection = undefined;
	}
	public updateStatus(): void {
		const input = this.input;
		if (this.detailsWindow.hasFocus) this.statusItems[0].text = input.details!.title;
		else if (this.worldControl.focusTarget.hasFocus && input.worldView.mode !== 'game') this.statusItems[0].text = input.worldView.mode === '3d'
			? 'RMB: LOOK | RMB+WASD/QE: FLY | ALT+LMB: ORBIT | MMB: PAN | F: FOCUS'
			: 'CLICK: INSPECT | RMB/MMB: PAN | WHEEL: ZOOM | F: FOCUS';
		else if (this.split.focusTarget.hasFocus) this.statusItems[0].text = this.boundSplit!.orientation === 'horizontal'
			? 'RESIZE PANES: LEFT/RIGHT | HOME: RESET' : 'RESIZE PANES: UP/DOWN | HOME: RESET';
		else if (this.viewportHit !== undefined) this.statusItems[0].text = this.viewportHit.label
			+ (this.controller.sceneAuthoring === undefined || this.gameInput.focusTarget.hasFocus ? '' : ' · Alt+drag: authored position');
		else if (input.presentation === 'world') this.statusItems[0].text = input.worldOutliner.tree.rows[input.worldOutliner.tree.selectionIndex]?.element.label ?? 'WORLD OUTLINER';
		else if (input.presentation === 'outline') this.statusItems[0].text = !input.dirty && input.actorPresent
			? input.selectedOutlineNode?.label ?? input.status : input.status;
		else {
			const target = input.stateGraph!.selectedTarget, available = !input.dirty && input.actorPresent;
			if (this.statusInput !== input || this.statusTopology !== input.runtime.topologyRevision
				|| this.statusTarget !== target || this.statusAvailable !== available) {
				this.statusInput = input; this.statusTopology = input.runtime.topologyRevision;
				this.statusTarget = target; this.statusAvailable = available;
				this.statusSelectionLabel = this.controller.selected(input)?.label;
			}
			this.statusItems[0].text = this.statusSelectionLabel ?? input.status;
		}
	}
	public draw(): void {
		drawActorLab(this.input, this.timelineSlider.focusTarget.hasFocus, this.graph.hover, this.graph.focusTarget.hasFocus, this.controller.viewport, this.outlinerControl);
		const drag = this.positionDrag, hit = drag.active ? drag.outline : this.viewportHit;
		if (!this.input.layout.previewVisible) return;
		if (this.input.worldView.mode === 'game' && hit !== undefined && this.controller.renderFrames.displayCurrent) {
			const bounds = this.input.previewBounds, frame = this.controller.viewportPicker.frame;
			const scaleX = (bounds.right - bounds.left) / frame.width, scaleY = (bounds.bottom - bounds.top) / frame.height;
			const dx = drag.active ? drag.dx : 0, dy = drag.active ? drag.dy : 0;
			api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
			api.blit_rect(bounds.left + (hit.left + dx) * scaleX, bounds.top + (hit.top + dy) * scaleY,
				bounds.left + (hit.right + dx) * scaleX, bounds.top + (hit.bottom + dy) * scaleY, 0, COLOR_TAB_BORDER);
			api.popClipRect();
		}
		this.gameInput.draw();
		drawWorkbenchSplit(this.input.layout.split!, this.split);
	}
	private showDetails(focus: boolean): void {
		updateFullWidthWorkbenchLayout(this.input.layout, this.contentBounds);
		if (!this.updateContentLayout()) return;
		const attached = this.detailsWindow.visible;
		this.input.detailsWindow.open = true;
		this.updateDetailsWindow();
		if (attached) this.surfaces.raise(this.detailsWindow.surface!);
		if (focus) this.inspector.focusTarget.focus();
	}
	public onPointerLeave(): void {
		this.viewportHover = false; this.viewportHit = undefined;
	}
	private updateViewportHit(): void {
		if (this.input.worldView.mode !== 'game') { this.viewportHit = undefined; return; }
		if (!this.input.layout.previewVisible || !this.viewportHover) return;
		this.viewportHit = undefined;
		const bounds = this.input.previewBounds, viewport = this.controller.viewport;
		const sequence = viewport.kind === 'direct' ? viewport.presenter.gameFrameSequence : viewport.frames.published.presentationSequence;
		if (this.controller.rewind.seeking || sequence === undefined
			|| !point_in_rect(this.pointerX, this.pointerY, bounds)) { pointerHover.release(this); return; }
		const frame = this.controller.viewportPicker.frame;
		this.viewportHit = this.controller.viewportPicker.pick(this.input.domain, sequence,
			(this.pointerX - bounds.left) * frame.width / (bounds.right - bounds.left),
			(this.pointerY - bounds.top) * frame.height / (bounds.bottom - bounds.top));
	}
	private beginPositionDrag(snapshot: PointerInputSnapshot): void {
		const controller = this.controller, input = this.input, authoring = controller.sceneAuthoring!;
		if (!controller.canInteract() || controller.rewind.active) return;
		this.updateViewportHit();
		const hit = this.viewportHit; if (hit === undefined) return;
		const { domain, hashId, quadIndex } = hit, frame = controller.viewportPicker.frame, sequence = frame.sequence;
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		controller.viewport.transport.pause(); input.interaction.running = false;
		controller.inspectActor(input, domain, hashId); this.update(); this.focusTarget.focus();
		const current = () => this.hasInput && this.input === input && scope.contextGeneration === context
			&& this.focusTarget.hasFocus && input.domain === domain && input.actorHashId === hashId && !controller.rewind.active
			&& frame.sequence === sequence && controller.renderFrames.displayCurrent;
		if (!current()) return;
		const source = authoring.positions.source(domain, hashId);
		const binding = source === undefined ? undefined : authoring.positions.bind(source);
		if (binding === undefined) {
			showEditorMessage('This visual has no editable authored member position matching its live pose. Open its source to edit the controller or construction.', 'info', 5); return;
		}
		const bounds = input.previewBounds, left = bounds.left, top = bounds.top, right = bounds.right, bottom = bounds.bottom;
		if (!this.positionDrag.begin(binding, frame.quads.peek(quadIndex), hit, snapshot, bounds, frame.width, frame.height, this.focusTarget,
			() => current() && bounds.left === left && bounds.top === top && bounds.right === right && bounds.bottom === bottom)) {
			showEditorMessage('The displayed pose cannot be moved through this authored position: its parent, local pose or source edit is unavailable.', 'info', 5);
		}
	}

	public handleKeyboard(input: KeyInputEvent): void {
		if (input.consumed) return;
		if (this.positionDrag.active && isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input); pointerCapture.cancelTarget(this.positionDrag); return;
		}
		if (this.input.presentation === 'world') { this.outlinerControl.handleKeyboard(input); return; }
		if (!this.input.actorPresent) return;
		if (this.input.presentation === 'graph') { this.handleGraphKeyboard(input); return; }
		for (const [key, command] of NAVIGATION) {
			if (!isKeyDown(key, input)) continue;
			consumeIdeKey(key, input);
			const selected = this.input;
			const result = navigateWorkbenchTree(selected.outline, command);
			if (!this.updateContentLayout()) return;
			if (result === WorkbenchTreeNavigationResult.Selection) selected.rememberSelection();
			return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.commands.execute('actorLab.details'); }
	}
	private updateContentLayout(): boolean {
		const input = this.input, layout = input.layout;
		if (input.timeline.visible) input.timelineLayout.update(input.timeline, layout);
		layoutActorLab(input);
		this.splitPosition = layout.split?.position;
		const bar = input.presentation === 'world' ? input.worldActions : input.presentation === 'outline' ? input.actionBar : input.stateGraphActions;
		layoutWorkbenchActionBar(bar, layout.primaryRight - 4,
			layout.top + 2, layout.top + layout.rowHeight + 8, measureText, editorViewState.font.renderFont(), layout.left + 4);
		if (input.presentation === 'graph') input.stateGraph!.titleLabel = truncateTextToWidth(input.stateGraph!.title, layout.primaryRight - layout.left - 16);
		return this.updatePreviewInput();
	}
	/** Arrangement retires old controls before admitting input for this attachment. */
	private updatePreviewInput(): boolean {
		const input = this.input, scope = this.focusTarget.scope, context = scope.contextGeneration;
		let restoreFocus = false;
		if (this.boundSplit !== input.layout.split) {
			this.boundSplit = input.layout.split;
			if (this.boundSplit !== undefined) this.split.setInput(this.boundSplit);
			else {
				restoreFocus = this.split.focusTarget.hasFocus;
				pointerCapture.cancelTarget(this.split);
				this.split.clearInput();
				pointerHover.release(this);
			}
		}
		if (scope.contextGeneration !== context) return false;
		const viewport = this.controller.viewport;
		if (input.worldView.mode === 'game' && input.layout.previewVisible && (viewport.kind === 'direct' || viewport.frames.bitmap !== undefined)) this.gameInput.setInput(input.previewBounds);
		else if (this.gameInput.focusTarget.guestInput !== undefined) {
			restoreFocus ||= this.gameInput.focusTarget.hasFocus;
			this.gameInput.clearInput();
		}
		if (scope.contextGeneration !== context) return false;
		const primary = this.commandTarget;
		primary.next = this.actions.focusTarget; this.actions.focusTarget.previous = primary;
		let previous = this.actions.focusTarget;
		if (input.timeline.slider.interactive) {
			previous.next = this.timelineSlider.focusTarget; this.timelineSlider.focusTarget.previous = previous;
			previous = this.timelineSlider.focusTarget;
		}
		if (input.layout.previewVisible) {
			previous.next = this.split.focusTarget; this.split.focusTarget.previous = previous;
			previous = this.split.focusTarget;
		}
		if (input.layout.previewVisible) {
			previous.next = this.worldControl.actions.focusTarget; this.worldControl.actions.focusTarget.previous = previous; previous = this.worldControl.actions.focusTarget;
			if (input.worldView.mode !== 'game') { previous.next = this.worldControl.focusTarget; this.worldControl.focusTarget.previous = previous; previous = this.worldControl.focusTarget; }
		}
		if (this.gameInput.focusTarget.guestInput !== undefined) {
			previous.next = this.gameInput.focusTarget; this.gameInput.focusTarget.previous = previous;
			previous = this.gameInput.focusTarget;
		}
		previous.next = primary; primary.previous = previous;
		// Pane commands address the contribution; pointer focus in its Outliner
		// is the same logical tab stop, not an unconnected keyboard island.
		this.outlinerControl.focusTarget.next = primary.next;
		this.outlinerControl.focusTarget.previous = primary.previous;
		if (restoreFocus && inputFocus.target === this.focusTarget) this.focus();
		return scope.contextGeneration === context;
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.input.layout.previewVisible && this.worldControl.handlePointer(snapshot, now)) return true;
		if (this.input.layout.previewVisible && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.previewBounds)) {
			if (!this.controller.rewind.seeking) {
				this.viewportHover = true; this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY; pointerHover.visit(this);
				if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && (snapshot.modifiers & KeyModifier.alt) !== 0
					&& !this.gameInput.focusTarget.hasFocus && this.controller.sceneAuthoring !== undefined) {
					this.beginPositionDrag(snapshot); return true;
				}
				if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && !this.gameInput.focusTarget.hasFocus) {
					this.updateViewportHit();
					if (this.viewportHit !== undefined) {
						const { domain, hashId } = this.viewportHit;
						this.showActorContextMenu(snapshot.viewportX, snapshot.viewportY, domain, hashId, this.worldControl.focusTarget, false);
						return true;
					}
				}
			}
			this.gameInput.handlePointer(snapshot);
			return false;
		}
		if (this.split.handlePointer(snapshot) || this.actions.handlePointer(snapshot) || this.input.timeline.visible && this.timelineSlider.handlePointer(snapshot)) return true;
		if (this.input.presentation === 'world') return this.outlinerControl.handlePointer(snapshot, now);
		if (!this.input.actorPresent) return false;
		if (this.input.presentation === 'outline' && (this.scrollbar.handlePointer(snapshot, this.input.outline.scrollbar)
			|| this.scrollbar.handlePointer(snapshot, this.input.outline.horizontalScrollbar))) {
			if (justPressed) this.input.follow.stop();
			return true;
		}
		if (this.input.presentation === 'graph') {
			// Runtime graphs reserve Space for transport; RMB/MMB still pan.
			const result = this.graph.handlePointer(snapshot, now, false);
			if (result === WorkbenchGraphPointerResult.Rejected) return true;
			if ((result === WorkbenchGraphPointerResult.Selection || result === WorkbenchGraphPointerResult.Activate) && !this.acceptGraphSelection()) return true;
			if (result === WorkbenchGraphPointerResult.Activate) this.commands.execute('actorLab.details');
			return result !== WorkbenchGraphPointerResult.Outside;
		}
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		const index = workbenchListRowIndexAtPosition(this.input.outline, snapshot.viewportX, snapshot.viewportY);
		if (index < 0) return false;
		if (justPressed || (snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			const input = this.input, row = input.outline.rows[index], scope = this.focusTarget.scope, context = scope.contextGeneration;
			this.focus();
			if (scope.contextGeneration !== context || inputFocus.admittedTarget !== this.focusTarget || input.outline.rows[index] !== row) return true;
			if (justPressed && workbenchTreeTwistieContainsPosition(input.outline, index, snapshot.viewportX, input.outline.scrollLeft)) {
				setWorkbenchTreeCollapsed(input.outline, index, !row.collapsed);
				this.updateContentLayout();
				return true;
			}
			input.outline.selectionIndex = index;
			input.rememberSelection();
			if (scope.contextGeneration !== context || input.presentation !== 'outline' || inputFocus.admittedTarget !== this.focusTarget
				|| input.outline.rows[input.outline.selectionIndex] !== row) return true;
			if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
				this.showInspectionContextMenu(snapshot.viewportX, snapshot.viewportY, this.focusTarget, false);
			}
		}
		return true;
	}
	public override handleWheel(event: WheelInputSnapshot): boolean {
		if (this.worldControl.handleWheel(event)) return true;
		if (this.input.presentation === 'world') return this.outlinerControl.handleWheel(event);
		if (this.input.presentation === 'graph') {
			if (!this.graph.handleWheel(event)) return false;
		} else {
			if (!this.input.outline.handleWheel(event)) return false;
			this.scrollbar.cancelPointer();
		}
		this.input.follow.stop();
		return true;
	}

	private acceptGraphSelection(): boolean {
		const input = this.input, graph = input.stateGraph!, selected = graph.viewport.selection;
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		graph.rememberSelection();
		return this.hasInput && this.input === input && scope.contextGeneration === context && input.presentation === 'graph'
			&& input.stateGraph === graph && graph.viewport.selection === selected && inputFocus.admittedTarget === this.graph.focusTarget;
	}

	private handleGraphKeyboard(player: KeyInputEvent): void {
		const view = this.input.stateGraph!.viewport;
		if (isKeyJustPressed('Escape', player)) { consumeIdeKey('Escape', player); this.commands.execute('actorLab.outline'); return; }
		if (isKeyJustPressed('Enter', player)) { consumeIdeKey('Enter', player); this.commands.execute('actorLab.details'); return; }
		for (const [key, direction] of GRAPH_SELECTION_KEYS) {
			if (!isKeyDown(key, player)) continue;
			consumeIdeKey(key, player); view.selectRelative(direction);
			if (view.selection !== null) view.reveal(view.selection);
			this.input.stateGraph!.rememberSelection();
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
