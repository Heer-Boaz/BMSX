import { getPressedState, makeButtonState, options, resetObject } from './input';
import type { ButtonState, InputHandler, KeyOrButtonId2ButtonState, VibrationParams } from './inputtypes';
import { Platform } from '../platform/platform_services';

const POINTER_BUTTON_MAP: Record<number, string> = {
	0: 'pointer_primary',
	1: 'pointer_aux',
	2: 'pointer_secondary',
	3: 'pointer_back',
	4: 'pointer_forward',
};

const POINTER_VECTOR_ID = 'pointer_position';
const POINTER_DELTA_ID = 'pointer_delta';
const POINTER_WHEEL_ID = 'pointer_wheel';

export class PointerInput implements InputHandler {
	public readonly gamepadIndex: null = null;

	private buttonStates: KeyOrButtonId2ButtonState = {};
	private pointerActive = false;
	private pointerId: number | null = null;
	private position: { x: number; y: number } | null = null;
	private wheelDelta = 0;
	private delta = { x: 0, y: 0 };
	private nextPressId = 1;
	private transitionsPrev = new Set<string>();
	private transitionsCurrent = new Set<string>();

	public get supportsVibrationEffect(): boolean {
		return false;
	}

	public applyVibrationEffect(_params: VibrationParams): void {
		// Pointer devices do not support vibration
	}

	public constructor(private readonly element: HTMLElement) {
		this.reset();
		this.bindEventListeners();
	}

	private bindEventListeners(): void {
		const input = Platform.instance.input;
		const target = this.element;
		input.addEventListener(target, 'pointerdown', this.handlePointerDown, options);
		input.addEventListener(target, 'pointermove', this.handlePointerMove, options);
		input.addEventListener(target, 'pointerup', this.handlePointerUp, options);
		input.addEventListener(target, 'pointercancel', this.handlePointerUp, options);
		input.addEventListener(target, 'pointerleave', this.handlePointerLeave, options);
		input.addEventListener(target, 'wheel', this.handleWheel, { ...options, passive: false });

		// Fallbacks for environments without pointer events
		input.addEventListener(target, 'mousedown', this.handleMouseDown, options);
		input.addEventListener(target, 'mousemove', this.handleMouseMove, options);
		input.addEventListener(target, 'mouseup', this.handleMouseUp, options);
		input.addEventListener(target, 'mouseleave', this.handleMouseLeave, options);

		input.addEventListener(target, 'touchstart', this.handleTouchStart, options);
		input.addEventListener(target, 'touchmove', this.handleTouchMove, options);
		input.addEventListener(target, 'touchend', this.handleTouchEnd, options);
		input.addEventListener(target, 'touchcancel', this.handleTouchEnd, options);
	}

	private handlePointerDown = (event: PointerEvent): void => {
		if (event.pointerType === 'mouse' && event.button > 4) return;
		this.updateButtonState(event.button, true);
		if (event.pointerType !== 'mouse') this.pointerId = event.pointerId;
		this.pointerActive = true;
		this.updatePosition(event.clientX, event.clientY);
	};

	private handlePointerMove = (event: PointerEvent): void => {
		if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
		const dx = typeof event.movementX === 'number'
			? event.movementX
			: (this.position ? event.clientX - this.position.x : 0);
		const dy = typeof event.movementY === 'number'
			? event.movementY
			: (this.position ? event.clientY - this.position.y : 0);
		this.accumulateDelta(dx, dy);
		this.updatePosition(event.clientX, event.clientY);
	};

	private handlePointerUp = (event: PointerEvent): void => {
		if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
		this.updateButtonState(event.button, false);
		if (event.type === 'pointerup') {
			this.pointerActive = false;
			this.pointerId = null;
		}
	};

	private handlePointerLeave = (_event: PointerEvent): void => {
		this.pointerActive = false;
		this.pointerId = null;
		this.position = null;
	};

	private handleWheel = (event: WheelEvent): void => {
		this.wheelDelta += event.deltaY;
		// Prevent page scroll when captured by the game surface
		event.preventDefault();
	};

	private handleMouseDown = (event: MouseEvent): void => {
		// Only run fallback if pointer events are not supported
		if (typeof window !== 'undefined' && window.PointerEvent) return;
		if (event.button > 4) return;
		this.updateButtonState(event.button, true);
		this.pointerActive = true;
		this.updatePosition(event.clientX, event.clientY);
	};

	private handleMouseMove = (event: MouseEvent): void => {
		if (typeof window !== 'undefined' && window.PointerEvent) return;
		if (!this.pointerActive) return;
		const dx = this.position ? event.clientX - this.position.x : 0;
		const dy = this.position ? event.clientY - this.position.y : 0;
		this.accumulateDelta(dx, dy);
		this.updatePosition(event.clientX, event.clientY);
	};

	private handleMouseUp = (event: MouseEvent): void => {
		if (typeof window !== 'undefined' && window.PointerEvent) return;
		this.updateButtonState(event.button, false);
		if (event.type === 'mouseup') {
			this.pointerActive = false;
		}
	};

	private handleMouseLeave = (_event: MouseEvent): void => {
		if (typeof window !== 'undefined' && window.PointerEvent) return;
		this.pointerActive = false;
		this.position = null;
	};

	private handleTouchStart = (event: TouchEvent): void => {
		if (typeof window !== 'undefined' && window.PointerEvent) return;
		const touch = event.changedTouches[0];
		if (!touch) return;
		this.updateButtonState(0, true);
		this.pointerActive = true;
		this.pointerId = touch.identifier;
		this.updatePosition(touch.clientX, touch.clientY);
	};

	private handleTouchMove = (event: TouchEvent): void => {
		if (typeof window !== 'undefined' && window.PointerEvent) return;
		if (!this.pointerActive || this.pointerId === null) return;
		const touch = Array.from(event.changedTouches).find(t => t.identifier === this.pointerId);
		if (!touch) return;
		const dx = this.position ? touch.clientX - this.position.x : 0;
		const dy = this.position ? touch.clientY - this.position.y : 0;
		this.accumulateDelta(dx, dy);
		this.updatePosition(touch.clientX, touch.clientY);
	};

	private handleTouchEnd = (event: TouchEvent): void => {
		if (window.PointerEvent) return;
		if (!this.pointerActive || this.pointerId === null) return;
		const touch = Array.from(event.changedTouches).find(t => t.identifier === this.pointerId);
		if (!touch) return;
		this.updateButtonState(0, false);
		this.pointerActive = false;
		this.pointerId = null;
	};

	private updateButtonState(buttonIndex: number, pressed: boolean): void {
		const key = POINTER_BUTTON_MAP[buttonIndex] ?? `pointer_button_${buttonIndex}`;
		const prev = this.buttonStates[key] ?? makeButtonState();
		const now = performance.now();
		if (pressed) {
			const newlyPressed = !prev.pressed;
			const pressId = newlyPressed ? this.nextPressId++ : prev.pressId ?? this.nextPressId++;
			this.buttonStates[key] = makeButtonState({
				pressed: true,
				justpressed: newlyPressed,
				waspressed: true,
				justreleased: false,
				pressId,
				pressedAtMs: newlyPressed ? now : prev.pressedAtMs ?? now,
				timestamp: now,
				value: 1,
			});
			if (newlyPressed) this.transitionsCurrent.add(key);
		} else {
			const justReleased = prev.pressed;
			this.buttonStates[key] = makeButtonState({
				pressed: false,
				justpressed: false,
				justreleased: justReleased,
				waspressed: prev.waspressed || justReleased,
				wasreleased: prev.wasreleased || justReleased,
				pressId: prev.pressId ?? null,
				releasedAtMs: justReleased ? now : prev.releasedAtMs ?? null,
				timestamp: now,
				value: 0,
			});
			if (justReleased) this.transitionsCurrent.add(key);
		}
	}

	private updatePosition(x: number, y: number): void {
		this.position = { x, y };
	}

	private accumulateDelta(dx: number, dy: number): void {
		if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
		if (dx === 0 && dy === 0) return;
		this.delta.x += dx;
		this.delta.y += dy;
	}

	public pollInput(): void {
		if (this.transitionsPrev.size) {
			for (const key of this.transitionsPrev) {
				const state = this.buttonStates[key];
				if (!state) continue;
				state.justpressed = false;
				state.justreleased = false;
			}
			this.transitionsPrev.clear();
		}

		// Decay wheel delta to report per-frame impulses
		if (this.wheelDelta !== 0) {
			const state = makeButtonState({
				pressed: false,
				justpressed: false,
				justreleased: false,
				value: this.wheelDelta,
			});
			this.buttonStates[POINTER_WHEEL_ID] = state;
			this.wheelDelta = 0;
		} else if (this.buttonStates[POINTER_WHEEL_ID]) {
			this.buttonStates[POINTER_WHEEL_ID] = makeButtonState();
		}

		if (this.position) {
			const state = makeButtonState({
				pressed: this.pointerActive,
				value2d: [this.position.x, this.position.y],
			});
			this.buttonStates[POINTER_VECTOR_ID] = state;
		} else if (this.buttonStates[POINTER_VECTOR_ID]) {
			this.buttonStates[POINTER_VECTOR_ID] = makeButtonState();
		}

		if (this.delta.x !== 0 || this.delta.y !== 0) {
			this.buttonStates[POINTER_DELTA_ID] = makeButtonState({
				value2d: [this.delta.x, this.delta.y],
			});
			this.delta.x = 0;
			this.delta.y = 0;
		} else if (this.buttonStates[POINTER_DELTA_ID]) {
			this.buttonStates[POINTER_DELTA_ID] = makeButtonState();
		}

		this.transitionsPrev = this.transitionsCurrent;
		this.transitionsCurrent = new Set();
	}

	public getButtonState(btn: string): ButtonState {
		return getPressedState(this.buttonStates, btn);
	}

	public consumeButton(button: string): void {
		const state = this.buttonStates[button];
		if (state) state.consumed = true;
	}

	public reset(except?: string[]): void {
		if (!except) {
			this.buttonStates = {};
		} else {
			resetObject(this.buttonStates, except);
		}
		this.pointerActive = false;
		this.pointerId = null;
		this.position = null;
		this.delta = { x: 0, y: 0 };
		this.wheelDelta = 0;
		this.transitionsPrev.clear();
		this.transitionsCurrent.clear();
	}

	public dispose(): void {
		this.reset();
	}
}
