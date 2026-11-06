import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../../../hosts/common/input/text';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import type { ResourceDomain } from '../../../common/resource';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { WorkbenchViewportNavigation } from '../../ui/viewport_navigation';
import { WorkbenchViewportClick } from '../../ui/viewport_click';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { ActorLabInput } from './editor_input';
import { ACTOR_VIEWPORT_CAMERA, ACTOR_VIEWPORT_VIEWS } from './viewport_menus';
import { GameInputControl } from '../game_view/game_input';
import { SceneLivePositionDrag } from '../scene_editor/live_drag';
import { ActorViewportSelection } from './viewport_selection';
import type { ActorViewportHit } from './viewport_pick';
import type { WorldActor } from './world_geometry';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { showEditorMessage } from '../../../common/feedback_state';
import { COLOR_TAB_BORDER } from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';

/** Input admission belongs to the live viewport, not global IDE shortcuts or the
 * game recipient. Camera gestures capture/release through ordinary UI ownership. */
export class ActorWorldControl {
	public readonly focusTarget: InputFocusTarget;
	public readonly actions: WorkbenchActionBarControl;
	private input: ActorLabInput | undefined;
	private readonly navigation: WorkbenchViewportNavigation;
	private readonly clicks: WorkbenchViewportClick;
	private gameInput: GameInputControl | undefined;
	private readonly positionDrag = new SceneLivePositionDrag();
	private readonly selection = new ActorViewportSelection();
	private mode: ActorLabInput['worldView']['mode'] | undefined;
	private unbindGuest: (() => void) | undefined;
	private hover = false;
	private pointerX = 0;
	private pointerY = 0;
	public hit: ActorViewportHit | undefined;
	private readonly commands: EditorCommandId[] = [];
	private readonly unbindKeyboard: () => void;
	public constructor(private readonly parent: InputFocusTarget, private readonly runner: EditorCommandRunner, private readonly menus: ContextMenuController,
		private readonly changed: () => void,
		private readonly actorContextMenu: (x: number, y: number, domain: ResourceDomain, hashId: number, keyboard: boolean) => void) {
		this.focusTarget = inputFocus.createTarget(parent); this.focusTarget.commandContext = parent;
		this.focusTarget.canFocus = () => this.input !== undefined && this.input.layout.previewVisible;
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, runner, this.focusTarget, () => this.focusTarget.focus(), menus);
		this.navigation = new WorkbenchViewportNavigation(inputFocus, pointerCapture, this.focusTarget, () => {
			const input = this.input!; input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
		}, (x, y) => this.openContextMenu(x, y));
		this.clicks = new WorkbenchViewportClick(inputFocus, pointerCapture, this.focusTarget, (x, y, button) => {
			if (button === PointerButton.Secondary) { this.openContextMenu(x, y); return; }
			const input = this.input!, actor = this.pick(x, y);
			if (actor !== undefined) input.controller.inspectActor(input, actor.domain, actor.hashId);
			this.changed();
		});
		const bind = (id: EditorCommandId, run: (input: ActorLabInput) => void,
			enabled: (input: ActorLabInput) => boolean, checked?: (input: ActorLabInput) => boolean) => {
			const implementation = {
				isEnabled: () => this.input !== undefined && this.input.layout.previewVisible && enabled(this.input),
				isChecked: checked === undefined ? undefined : () => this.input !== undefined && checked(this.input),
				run: () => {
					this.clicks.cancel(); this.navigation.cancel(); const input = this.input!; run(input);
					input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
					this.update();
				} }; parent.registerCommand(id, implementation); this.focusTarget.registerCommand(id, implementation); this.commands.push(id);
		};
		parent.registerCommand('actorLab.controlGame', {
			isEnabled: () => this.gameInput?.focusTarget.guestInput !== undefined,
			run: () => { this.clicks.cancel(); this.navigation.cancel(); this.gameInput!.focusTarget.focus(); },
		}); this.commands.push('actorLab.controlGame');
		for (const mode of ['game', '2d', '3d'] as const) bind(mode === 'game' ? 'actorLab.gameView' : `sceneViewport.view${mode}`,
			input => { input.worldView.setMode(mode); this.changed(); }, () => true, input => input.worldView.mode === mode);
		const canNavigate = (input: ActorLabInput) => input.worldView.mode !== 'game';
		bind('sceneViewport.frameAll', input => input.worldView.frameAll(false), canNavigate);
		bind('sceneViewport.frameSelection', input => input.worldView.frameAll(true), input => canNavigate(input) && input.actorPresent);
		bind('sceneViewport.zoomIn', input => input.worldView.camera.zoom(1, 0, 0), canNavigate);
		bind('sceneViewport.zoomOut', input => input.worldView.camera.zoom(-1, 0, 0), canNavigate);
		for (const tool of ['select', 'pan', 'orbit'] as const) bind(tool === 'select' ? 'actorLab.selectVisual' : `sceneViewport.${tool}`,
			input => { input.worldView.navigationTool = tool; }, input => tool === 'orbit' ? input.worldView.mode === '3d' : canNavigate(input),
			input => input.worldView.navigationTool === tool);
		for (const id of ['actorLab.viewOptions', 'actorLab.cameraOptions'] as const) {
			parent.registerCommand(id, {
				isEnabled: () => this.input !== undefined && this.input.layout.previewVisible && (id === 'actorLab.viewOptions' || canNavigate(this.input)),
				isChecked: () => id === 'actorLab.cameraOptions' && this.input !== undefined && canNavigate(this.input) && this.input.worldView.navigationTool !== 'select',
				run: () => {
					const actions = this.input!.viewportActions, item = actions.items.find(item => item.command === id)!;
					const bounds = item.overflowed ? actions.overflow!.button.bounds : item.bounds;
					menus.show(bounds.left, bounds.bottom, id === 'actorLab.viewOptions' ? ACTOR_VIEWPORT_VIEWS : ACTOR_VIEWPORT_CAMERA,
						runner, { placement: 'below', selectFirst: true, invocationOrigin: this.actions.focusTarget, commandTarget: parent });
				},
			}); this.commands.push(id);
		}
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => {
			if (this.positionDrag.active && isKeyJustPressed('Escape', event)) {
				consumeIdeKey('Escape', event); pointerCapture.cancelTarget(this.positionDrag); return;
			}
			if (isKeyJustPressed('Escape', event)) this.clicks.cancel();
			this.navigation.handleKeyboard(event, editorRuntimeState.currentTimeMs);
		});
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.focusTarget.canFocus!(),
			run: () => { const b = this.input!.previewBounds; this.openContextMenu(b.left + 4, b.top + 4, true); },
		});
	}
	private openContextMenu(x: number, y: number, keyboard = false): void {
		const input = this.input!;
		let domain = input.domain, hashId = input.actorHashId;
		if (keyboard) {
			if (!input.actorPresent) { this.openCameraMenu(x, y, true); return; }
		} else {
			const actor = this.pick(x, y);
			if (actor === undefined) { this.openCameraMenu(x, y); return; }
			domain = actor.domain; hashId = actor.hashId;
		}
		this.actorContextMenu(x, y, domain, hashId, keyboard);
	}
	private openCameraMenu(x: number, y: number, keyboard = false): void {
		this.menus.show(x, y, ACTOR_VIEWPORT_CAMERA, this.runner, {
			invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.parent, selectFirst: keyboard,
		});
	}
	public setInput(input: ActorLabInput): void {
		if (this.input === input) return;
		this.clearInput(); this.input = input;
		const controller = input.controller;
		this.gameInput = new GameInputControl(this.focusTarget, controller.viewport.recipient, controller.viewport, input.interaction);
		this.unbindGuest = controller.guest.onDidInvalidate(reason => {
			if (reason === 'execution') return;
			this.clicks.cancel(); this.navigation.cancel(); pointerCapture.cancelTarget(this.positionDrag); pointerHover.release(this);
		});
		this.actions.setInput(input.viewportActions, this.parent);
		if (this.layout()) this.update();
	}
	/** Layout owns gesture retirement and game-input admission for this attachment. */
	public layout(): boolean {
		const input = this.input!, view = input.worldView, gameInput = this.gameInput!, context = this.focusTarget.scope.contextGeneration;
		if (this.mode !== view.mode || !input.layout.previewVisible) {
			this.clicks.cancel(); this.navigation.cancel(); pointerCapture.cancelTarget(this.positionDrag); pointerHover.release(this);
			this.mode = view.mode;
		}
		this.clicks.layout(input.previewBounds);
		const viewport = input.controller.viewport;
		if (view.mode === 'game' && input.layout.previewVisible && (viewport.kind === 'direct' || viewport.frames.bitmap !== undefined)) gameInput.setInput(input.previewBounds);
		else if (gameInput.focusTarget.guestInput !== undefined) {
			const restoreFocus = gameInput.focusTarget.hasFocus;
			gameInput.clearInput();
			if (this.input !== input || this.focusTarget.scope.contextGeneration !== context) return false;
			if (restoreFocus && inputFocus.target === this.parent) this.parent.commandContext.focus();
		}
		if (this.input !== input || this.focusTarget.scope.contextGeneration !== context) return false;
		if (input.layout.previewVisible && view.mode !== 'game') this.navigation.setInput(view, input.previewBounds);
		else this.navigation.clearInput();
		if (!input.layout.previewVisible && this.menus.visible
			&& (this.menus.invocationOrigin === this.focusTarget || this.menus.invocationOrigin === this.actions.focusTarget)) this.menus.hide();
		this.actions.update(); return this.input === input && this.focusTarget.scope.contextGeneration === context;
	}
	public update(): void {
		this.positionDrag.refresh();
		const input = this.input!;
		this.navigation.advance(editorRuntimeState.currentTimeMs);
		if (input.layout.previewVisible) input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
		this.hit = undefined;
		if (this.hover && input.worldView.mode === 'game' && input.layout.previewVisible && !this.gameInput!.focusTarget.hasFocus) {
			this.hit = this.pickGame(this.pointerX, this.pointerY);
		}
		this.actions.update();
	}
	public handlePointer(snapshot: PointerInputSnapshot, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input!, view = input.worldView;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, input.viewportActions.bounds)) return true;
		if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, input.previewBounds)) return false;
		if (this.gameInput!.focusTarget.hasFocus) return false;
		this.hover = true; this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY; pointerHover.visit(this);
		const primary = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if (view.mode === 'game' && primary && (snapshot.modifiers & KeyModifier.alt) !== 0 && input.controller.sceneAuthoring !== undefined) {
			this.beginPositionDrag(snapshot); return true;
		}
		if (this.navigation.handlePointer(snapshot, now)) return true;
		if (primary) this.clicks.begin(snapshot, PointerButton.Primary);
		else if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) this.clicks.begin(snapshot, PointerButton.Secondary);
		return true;
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		const input = this.input!, view = input.worldView, b = input.previewBounds;
		if (!input.layout.previewVisible || !event.valid) return false;
		if (point_in_rect(event.viewportX, event.viewportY, input.viewportActions.bounds)) return true;
		if (view.mode === 'game' || !point_in_rect(event.viewportX, event.viewportY, b)) return false;
		this.clicks.cancel();
		const x = event.viewportX - (b.left + b.right) / 2, y = event.viewportY - (b.top + b.bottom) / 2;
		const anchor = view.mode === '3d' && !this.navigation.flying ? view.geometry.pick(x, y, view.camera) : undefined;
		return this.navigation.handleWheel(event, editorRuntimeState.currentTimeMs, anchor);
	}
	private pick(x: number, y: number): WorldActor | undefined {
		const input = this.input!;
		if (input.controller.rewind.seeking) return;
		return input.worldView.mode === 'game' ? this.pickGame(x, y) : input.worldView.pick(x, y);
	}
	private pickGame(x: number, y: number): ActorViewportHit | undefined {
		const input = this.input!, controller = input.controller, bounds = input.previewBounds, viewport = controller.viewport;
		if (controller.rewind.seeking || !point_in_rect(x, y, bounds)) return;
		const sequence = viewport.kind === 'direct' ? viewport.presenter.gameFrameSequence : viewport.frames.published.presentationSequence;
		const frame = controller.viewportPicker.frame;
		return controller.viewportPicker.pick(input.domain, sequence,
			(x - bounds.left) * frame.width / (bounds.right - bounds.left),
			(y - bounds.top) * frame.height / (bounds.bottom - bounds.top));
	}
	public onPointerLeave(): void { this.hover = false; this.hit = undefined; }
	private beginPositionDrag(snapshot: PointerInputSnapshot): void {
		const input = this.input!, controller = input.controller, authoring = controller.sceneAuthoring!;
		if (!controller.canInteract() || controller.rewind.active) return;
		const hit = this.pickGame(snapshot.viewportX, snapshot.viewportY); if (hit === undefined) return;
		const { domain, hashId, quadIndex } = hit, frame = controller.viewportPicker.frame, sequence = frame.sequence;
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		controller.viewport.transport.pause(); input.interaction.running = false;
		controller.inspectActor(input, domain, hashId); this.changed(); this.focusTarget.focus();
		const current = () => this.input === input && scope.contextGeneration === context
			&& this.focusTarget.hasFocus && input.worldView.mode === 'game' && input.domain === domain && input.actorHashId === hashId && !controller.rewind.active
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
	public draw(): void {
		const input = this.input!, controller = input.controller;
		if (!input.layout.previewVisible) return;
		if (input.worldView.mode === 'game' && controller.renderFrames.displayCurrent) {
			const bounds = input.previewBounds, frame = controller.viewportPicker.frame;
			this.selection.update(frame, controller.renderFrames.revision, input.domain, input.actorHashId, bounds);
			this.selection.draw(bounds);
			const drag = this.positionDrag, hit = drag.active ? drag.outline : this.hit;
			if (hit !== undefined) {
				const scaleX = (bounds.right - bounds.left) / frame.width, scaleY = (bounds.bottom - bounds.top) / frame.height;
				const dx = drag.active ? drag.dx : 0, dy = drag.active ? drag.dy : 0;
				api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
				api.blit_rect(bounds.left + (hit.left + dx) * scaleX, bounds.top + (hit.top + dy) * scaleY,
					bounds.left + (hit.right + dx) * scaleX, bounds.top + (hit.bottom + dy) * scaleY, 0, COLOR_TAB_BORDER);
				api.popClipRect();
			}
		}
		this.gameInput!.draw();
	}
	public clearInput(): void {
		const gameInput = this.gameInput;
		this.input = undefined; this.gameInput = undefined; this.mode = undefined;
		this.unbindGuest?.(); this.unbindGuest = undefined;
		this.clicks.cancel(); this.navigation.clearInput(); pointerCapture.cancelTarget(this.positionDrag); pointerHover.release(this); this.selection.clear();
		if (this.menus.visible && (this.menus.invocationOrigin === this.focusTarget || this.menus.invocationOrigin === this.actions.focusTarget)) this.menus.hide();
		this.actions.clearInput(); gameInput?.dispose();
	}
	public dispose(): void { this.clearInput(); this.clicks.dispose(); this.navigation.dispose(); this.actions.dispose(); this.unbindKeyboard(); this.focusTarget.unregisterCommand('contextMenu');
		for (const id of this.commands) { this.parent.unregisterCommand(id); this.focusTarget.unregisterCommand(id); } }
}
