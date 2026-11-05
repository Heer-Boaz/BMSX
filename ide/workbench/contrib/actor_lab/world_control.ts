import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { clamp } from '../../../../machine/ts/common/clamp';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { ViewportFlightInput } from '../../../input/viewport_flight';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { ActorLabInput } from './editor_input';
import { ACTOR_VIEWPORT_CAMERA, ACTOR_VIEWPORT_VIEWS } from './viewport_menus';

/** Input admission belongs to the live viewport, not global IDE shortcuts or the
 * game recipient. Camera gestures capture/release through ordinary UI ownership. */
export class ActorWorldControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly actions: WorkbenchActionBarControl;
	private input: ActorLabInput | undefined;
	private gesture: 'pan' | 'orbit' | 'look' | 'dolly' | undefined;
	private x = 0; private y = 0;
	private readonly flight = new ViewportFlightInput();
	private popup: DisposableStore | undefined;
	private readonly commands: EditorCommandId[] = [];
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public constructor(private readonly parent: InputFocusTarget, runner: EditorCommandRunner, private readonly menus: ContextMenuController,
		private readonly changed: () => void) {
		this.focusTarget = inputFocus.createTarget(parent); this.focusTarget.commandContext = parent;
		this.focusTarget.canFocus = () => this.input !== undefined && this.input.layout.previewVisible && this.input.worldView.mode !== 'game';
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, runner, this.focusTarget, () => this.focusTarget.focus(), menus);
		const bind = (id: EditorCommandId, run: (input: ActorLabInput) => void,
			enabled: (input: ActorLabInput) => boolean, checked?: (input: ActorLabInput) => boolean) => {
			parent.registerCommand(id, {
				isEnabled: () => this.input !== undefined && this.input.layout.previewVisible && enabled(this.input),
				isChecked: checked === undefined ? undefined : () => this.input !== undefined && checked(this.input),
				run: () => {
					pointerCapture.cancelTarget(this); const input = this.input!; run(input);
					input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
					this.update();
				} }); this.commands.push(id);
		};
		for (const mode of ['game', '2d', '3d'] as const) bind(mode === 'game' ? 'actorLab.gameView' : `sceneViewport.view${mode}`,
			input => { input.worldView.setMode(mode); this.changed(); }, () => true, input => input.worldView.mode === mode);
		const canNavigate = (input: ActorLabInput) => input.worldView.mode !== 'game';
		bind('sceneViewport.frameAll', input => input.worldView.frameAll(false), canNavigate);
		bind('sceneViewport.frameSelection', input => input.worldView.frameAll(true), input => canNavigate(input) && input.actorPresent);
		bind('sceneViewport.zoomIn', input => input.worldView.camera.zoom(1, 0, 0), canNavigate);
		bind('sceneViewport.zoomOut', input => input.worldView.camera.zoom(-1, 0, 0), canNavigate);
		for (const tool of ['select', 'pan', 'orbit'] as const) bind(tool === 'select' ? 'actorLab.selectVisual' : `sceneViewport.${tool}`,
			input => { input.worldView.navigation = tool; }, input => tool === 'orbit' ? input.worldView.mode === '3d' : canNavigate(input),
			input => input.worldView.navigation === tool);
		for (const id of ['actorLab.viewOptions', 'actorLab.cameraOptions'] as const) {
			parent.registerCommand(id, {
				isEnabled: () => this.input !== undefined && this.input.layout.previewVisible && (id === 'actorLab.viewOptions' || canNavigate(this.input)),
				run: () => {
					const actions = this.input!.viewportActions, item = actions.items.find(item => item.command === id)!;
					const bounds = item.overflowed ? actions.overflow!.button.bounds : item.bounds;
					menus.show(bounds.left, bounds.bottom, id === 'actorLab.viewOptions' ? ACTOR_VIEWPORT_VIEWS : ACTOR_VIEWPORT_CAMERA,
						runner, { placement: 'below', selectFirst: true, invocationOrigin: this.actions.focusTarget, commandTarget: parent,
							onWillShow: lifetime => {
								this.popup = lifetime;
								lifetime.add({ dispose: () => { if (this.popup === lifetime) this.popup = undefined; } });
							} });
				},
			}); this.commands.push(id);
		}
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event), () => pointerCapture.cancelTarget(this));
		this.unbindBlur = this.focusTarget.onDidBlur(() => pointerCapture.cancelTarget(this));
	}
	public setInput(input: ActorLabInput): void { this.input = input; this.actions.setInput(input.viewportActions, this.parent); }
	public update(): void {
		const input = this.input!, view = input.worldView;
		if (!input.layout.previewVisible || view.mode === 'game') pointerCapture.cancelTarget(this);
		if (!input.layout.previewVisible && this.popup !== undefined) this.menus.hide();
		for (const item of input.viewportActions.items) item.checked = item.command === 'actorLab.cameraOptions' && view.mode !== 'game' && view.navigation !== 'select';
		this.actions.update();
	}
	public handlePointer(snapshot: PointerInputSnapshot, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input!, view = input.worldView;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, input.viewportActions.bounds)) return true;
		if (view.mode === 'game' || !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.previewBounds)) return false;
		const primary = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		const middle = (snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0;
		const secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if (!primary && !middle && !secondary) return true;
		this.focusTarget.focus();
		const alt = (snapshot.modifiers & KeyModifier.alt) !== 0;
		if (middle || secondary || primary && (alt || view.navigation !== 'select')) {
			if (middle) this.gesture = 'pan';
			else if (secondary) this.gesture = alt ? 'dolly' : view.mode === '3d' ? 'look' : 'pan';
			else this.gesture = view.mode === '3d' && (alt || view.navigation === 'orbit') ? 'orbit' : 'pan';
			this.x = snapshot.viewportX; this.y = snapshot.viewportY;
			this.flight.begin(now);
			pointerCapture.capture(this, middle ? PointerButton.Auxiliary : secondary ? PointerButton.Secondary : PointerButton.Primary, this.focusTarget.scope.surfaceScope); return true;
		}
		const actor = view.pick(snapshot.viewportX, snapshot.viewportY);
		if (!input.controller.rewind.seeking) input.controller.inspectActor(input, actor === undefined ? input.domain : actor.domain,
			actor === undefined ? 0 : actor.hashId);
		this.changed(); return true;
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot, now: number): void {
		if (this.gesture === undefined) return;
		const flew = this.advanceNavigation(now);
		const input = this.input!, view = input.worldView, camera = view.camera, x = snapshot.viewportX - this.x, y = snapshot.viewportY - this.y;
		this.x = snapshot.viewportX; this.y = snapshot.viewportY;
		if (x === 0 && y === 0 && !flew) return;
		if (x !== 0 || y !== 0) {
			if (this.gesture === 'pan' || (snapshot.pressedButtons & (PointerButton.Primary | PointerButton.Secondary)) === (PointerButton.Primary | PointerButton.Secondary)) camera.pan(x, y);
			else if (this.gesture === 'orbit') camera.orbit(x, y);
			else if (this.gesture === 'look') camera.look(x, y);
			else camera.zoom(-y * 0.01, 0, 0);
		}
		view.refresh(input.previewBounds, input.domain, input.actorHashId);
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot, now: number): void { this.handleCapturedPointer(snapshot, now); this.cancelPointer(); }
	public cancelPointer(): void { this.gesture = undefined; this.flight.clear(); pointerCapture.release(this); }
	/** Host-time flight only changes the camera; the caller projects once after all input changes. */
	public advanceNavigation(now: number): boolean {
		if (this.gesture !== 'look') return false;
		const view = this.input!.worldView, flight = this.flight;
		return flight.advance(now, 240 * view.navigationSpeed / view.camera.scale)
			&& view.camera.fly(flight.right, flight.up, flight.forward, flight.localUp);
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		const input = this.input!, view = input.worldView, b = input.previewBounds;
		if (!input.layout.previewVisible || !event.valid) return false;
		if (point_in_rect(event.viewportX, event.viewportY, input.viewportActions.bounds)) return true;
		if (view.mode === 'game' || !point_in_rect(event.viewportX, event.viewportY, b)) return false;
		if (this.gesture === 'look') {
			if (this.advanceNavigation(editorRuntimeState.currentTimeMs)) view.refresh(b, input.domain, input.actorHashId);
			view.navigationSpeed = clamp(view.navigationSpeed * 2 ** (-event.deltaY / 4), 1 / 64, 64);
			return true;
		}
		pointerCapture.cancelTarget(this);
		const x = event.viewportX - (b.left + b.right) / 2, y = event.viewportY - (b.top + b.bottom) / 2;
		view.camera.zoom(-event.deltaY / 4, view.mode === '3d' ? 0 : x, view.mode === '3d' ? 0 : y);
		view.refresh(b, input.domain, input.actorHashId); return true;
	}
	private handleKeyboard(event: KeyInputEvent): void {
		if (event.consumed) return;
		if (isKeyJustPressed('Escape', event)) { consumeIdeKey('Escape', event); pointerCapture.cancelTarget(this); return; }
		if (this.gesture === 'look') {
			const input = this.input!;
			if (this.advanceNavigation(editorRuntimeState.currentTimeMs)) input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
			if (this.flight.key(event.code, event.down)) { consumeIdeKey(event.code, event); return; }
		}
		if ((event.modifiers & (KeyModifier.ctrl | KeyModifier.meta | KeyModifier.alt)) !== 0) return;
		if (isKeyJustPressed('KeyF', event)) { consumeIdeKey('KeyF', event); const input = this.input!;
			input.worldView.frameAll(true); input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId); }
	}
	public clearInput(): void {
		pointerCapture.cancelTarget(this);
		if (this.popup !== undefined) this.menus.hide();
		this.input = undefined; this.actions.clearInput();
	}
	public dispose(): void { this.clearInput(); this.actions.dispose(); this.unbindKeyboard(); this.unbindBlur(); for (const id of this.commands) this.parent.unregisterCommand(id); }
}
