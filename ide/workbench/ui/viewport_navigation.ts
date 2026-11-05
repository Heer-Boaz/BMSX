import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../hosts/common/input/text';
import { clamp } from '../../../machine/ts/common/clamp';
import { create_rect_bounds, point_in_rect, type RectBounds } from '../../../machine/ts/common/rect';
import { POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../input/keyboard/key_input';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import { ViewportFlightInput } from '../../input/viewport_flight';
import type { ViewportCameraPoint, WorkbenchViewportCamera } from './viewport_camera';

export type WorkbenchViewportNavigationState = {
	readonly camera: WorkbenchViewportCamera;
	navigationTool: 'select' | 'pan' | 'orbit';
	navigationSpeed: number;
};
type Gesture = {
	readonly kind: 'pan' | 'orbit' | 'look' | 'dolly';
	readonly mode: '2d' | '3d';
	contextMenu: boolean;
	x: number;
	y: number;
};

/** Editor-camera input shared by authored and live viewports. Content selection,
 * source transactions and game input remain with their respective owners. */
export class WorkbenchViewportNavigation implements PointerCaptureTarget {
	private input: WorkbenchViewportNavigationState | undefined;
	private generation = 0;
	private readonly bounds = create_rect_bounds();
	private gesture: Gesture | undefined;
	private readonly flight = new ViewportFlightInput();
	private unbindCamera: (() => void) | undefined;
	private unbindContext: (() => void) | undefined;
	private readonly unbindBlur: () => void;
	private readonly unbindCancel: () => void;
	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly focusTarget: InputFocusTarget, private readonly changed: () => void,
		private readonly contextClick: (x: number, y: number) => void) {
		this.unbindBlur = focusTarget.onDidBlur(next => {
			// A mouse-only drag can keep its panel's pointer ownership. Flight also
			// owns held keys, so losing the concrete keyboard recipient ends it.
			if (this.gesture?.kind === 'look' || next === null || !focusTarget.parent!.scope.contains(next.scope)) this.cancel();
		});
		this.unbindCancel = focusTarget.onDidCancelInput(() => { if (this.gesture?.kind === 'look') this.cancel(); });
	}
	public get active(): boolean { return this.gesture !== undefined; }
	public get flying(): boolean { return this.gesture?.kind === 'look'; }
	public setInput(input: WorkbenchViewportNavigationState, bounds: Readonly<RectBounds>): void {
		if (this.input !== input) { this.clearInput(); this.input = input; }
		this.layout(bounds);
	}
	public layout(bounds: Readonly<RectBounds>): void {
		const current = this.bounds;
		if (current.left === bounds.left && current.top === bounds.top && current.right === bounds.right && current.bottom === bounds.bottom) return;
		this.cancel(); Object.assign(current, bounds);
	}
	public clearInput(): void { this.cancel(); this.input = undefined; }
	public dispose(): void { this.clearInput(); this.unbindBlur(); this.unbindCancel(); }
	/** Revokes an admitted gesture and any press currently yielding to focus/source callbacks. */
	public cancel(): void { this.generation++; this.capture.cancelTarget(this); this.cancelPointer(); }
	public cancelPointer(): void {
		this.gesture = undefined; this.flight.clear(); this.capture.release(this);
		this.unbindCamera?.(); this.unbindCamera = undefined;
		this.unbindContext?.(); this.unbindContext = undefined;
	}
	/** Called before content hit-testing: these presses must never select or edit. */
	public handlePointer(snapshot: PointerInputSnapshot, now: number): boolean {
		const input = this.input;
		if (input === undefined || !snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) return false;
		const pressed = snapshot.justPressedButtons;
		const primary = (pressed & PointerButton.Primary) !== 0, secondary = (pressed & PointerButton.Secondary) !== 0;
		const middle = (pressed & PointerButton.Auxiliary) !== 0, alt = (snapshot.modifiers & KeyModifier.alt) !== 0;
		if (!middle && !secondary && !(primary && (alt || input.navigationTool !== 'select'))) return false;
		const generation = this.focusTarget.scope.contextGeneration, attachment = this.generation;
		if (!this.focusTarget.focus() || this.generation !== attachment || this.focusTarget.scope.contextGeneration !== generation
			|| this.focus.admittedTarget !== this.focusTarget) return true;
		const mode = input.camera.mode;
		const kind = middle ? 'pan' : secondary ? alt ? 'dolly' : mode === '3d' ? 'look' : 'pan'
			: mode === '3d' && (alt || input.navigationTool === 'orbit') ? 'orbit' : 'pan';
		this.cancel();
		this.gesture = { kind, mode, x: snapshot.viewportX, y: snapshot.viewportY,
			contextMenu: secondary && !alt && ((snapshot.pressedButtons | pressed) & (PointerButton.Primary | PointerButton.Auxiliary)) === 0 };
		this.flight.begin(now);
		this.unbindCamera = input.camera.onDidChange(() => { if (input.camera.mode !== mode) this.cancel(); });
		this.unbindContext = this.focusTarget.scope.onDidRetireContext(() => this.cancel());
		const button = middle ? PointerButton.Auxiliary : secondary ? PointerButton.Secondary : PointerButton.Primary;
		this.capture.capture(this, button, this.focusTarget.scope.surfaceScope);
		if ((snapshot.justReleasedButtons & button) !== 0) this.releaseCapturedPointer(snapshot, now);
		return true;
	}
	/** Integrate once before the owner's normal projection, independently of mouse event rate. */
	public advance(now: number): boolean {
		const gesture = this.gesture;
		if (gesture?.kind !== 'look') return false;
		const input = this.input!, flight = this.flight;
		if (!flight.advance(now, 240 * input.navigationSpeed / input.camera.scale)) return false;
		gesture.contextMenu = false;
		return input.camera.fly(flight.right, flight.up, flight.forward, flight.localUp);
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot, now: number): void {
		const gesture = this.gesture; if (gesture === undefined) return;
		const camera = this.input!.camera, flew = this.advance(now);
		if (this.gesture !== gesture) return;
		const x = snapshot.viewportX - gesture.x, y = snapshot.viewportY - gesture.y;
		const both = (snapshot.pressedButtons & (PointerButton.Primary | PointerButton.Secondary)) === (PointerButton.Primary | PointerButton.Secondary);
		if (both) gesture.contextMenu = false;
		if (gesture.contextMenu) {
			if (Math.max(Math.abs(x), Math.abs(y)) < POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			gesture.contextMenu = false;
		}
		gesture.x = snapshot.viewportX; gesture.y = snapshot.viewportY;
		if (x === 0 && y === 0 && !flew) return;
		if (x !== 0 || y !== 0) {
			if (both) { if (camera.mode === '3d') camera.pan(x, y); else camera.zoom(-y * 0.01, 0, 0); }
			else if (gesture.kind === 'pan') camera.pan(x, y);
			else if (gesture.kind === 'orbit') camera.orbit(x, y);
			else if (gesture.kind === 'look') camera.look(x, y);
			else camera.zoom(-y * 0.01, 0, 0);
		}
		if (this.gesture === gesture) this.changed();
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot, now: number): void {
		const gesture = this.gesture; if (gesture === undefined) return;
		this.handleCapturedPointer(snapshot, now);
		if (this.gesture !== gesture) return;
		this.cancelPointer();
		if (gesture.contextMenu && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) this.contextClick(snapshot.viewportX, snapshot.viewportY);
	}
	public handleWheel(event: WheelInputSnapshot, now: number, anchor?: Readonly<ViewportCameraPoint>): boolean {
		const input = this.input;
		if (input === undefined || !event.valid || !point_in_rect(event.viewportX, event.viewportY, this.bounds)) return false;
		if (this.handleCapturedWheel(event, now)) return true;
		this.cancel();
		const x = event.viewportX - (this.bounds.left + this.bounds.right) / 2, y = event.viewportY - (this.bounds.top + this.bounds.bottom) / 2;
		input.camera.zoom(-event.deltaY / 4, x, y, anchor);
		if (this.input === input) this.changed();
		return true;
	}
	public handleCapturedWheel(event: WheelInputSnapshot, now: number): boolean {
		const gesture = this.gesture;
		if (gesture?.kind !== 'look') return false;
		const input = this.input!, moved = this.advance(now);
		if (this.gesture !== gesture) return true;
		gesture.contextMenu = false;
		input.navigationSpeed = clamp(input.navigationSpeed * 2 ** (-event.deltaY / 4), 1 / 64, 64);
		if (moved) this.changed();
		return true;
	}
	public handleKeyboard(event: KeyInputEvent, now: number): void {
		if (event.consumed) return;
		if (this.active && isKeyJustPressed('Escape', event)) { consumeIdeKey('Escape', event); this.cancel(); return; }
		const gesture = this.gesture;
		if (gesture?.kind === 'look') {
			if (this.advance(now) && this.gesture === gesture) this.changed();
			if (this.gesture !== gesture) { consumeIdeKey(event.code, event); return; }
			if (this.flight.key(event.code, event.down)) {
				if (event.down) gesture.contextMenu = false;
				consumeIdeKey(event.code, event); return;
			}
		}
		if ((event.modifiers & (KeyModifier.ctrl | KeyModifier.meta | KeyModifier.alt)) !== 0) return;
		if (isKeyJustPressed('KeyF', event)) {
			consumeIdeKey('KeyF', event);
			this.focus.executeCommand((event.modifiers & KeyModifier.shift) !== 0 ? 'sceneViewport.frameAll' : 'sceneViewport.frameSelection', this.focusTarget);
		} else if (event.modifiers === KeyModifier.none && (isKeyJustPressed('Digit2', event) || isKeyJustPressed('Digit3', event))) {
			consumeIdeKey(event.code, event); this.focus.executeCommand(event.code === 'Digit2' ? 'sceneViewport.view2d' : 'sceneViewport.view3d', this.focusTarget);
		}
	}
}
