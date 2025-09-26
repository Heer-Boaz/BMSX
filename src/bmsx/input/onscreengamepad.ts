import { getPressedState, Input, makeButtonState, options, resetObject } from './input';
import type { BGamepadButton, VibrationParams } from './inputtypes';
import { ButtonState, InputHandler, KeyOrButtonId2ButtonState } from './inputtypes';

/**
 * Represents an on-screen gamepad for handling input in a game.
 * Implements the IInputHandler interface to manage gamepad button states,
 * using pointer events for both directional and action buttons.
 * It is used to simulate gamepad input on touch/pointer devices, and is intended to be used in conjunction with the {@link Input} class.
 *
 * @class OnscreenGamepad
 * @implements {InputHandler}
 */
export class OnscreenGamepad implements InputHandler {
	/** Controller to manage and remove all listeners in one go. */
	private controller: AbortController | null = null;

	/** Active-press counters per logical button (e.g., 'up', 'a'). */
	private activeCounts: Record<string, number> = {};
	/** Map pointerId -> set of logical buttons currently engaged by that pointer. */
	private pointer2Buttons = new Map<number, Set<string>>();
	/** Map pointerId -> set of element ids currently engaged by that pointer (for UI). */
	private pointer2Elements = new Map<number, Set<string>>();
	/** Per-element active pointer count to drive dataset/class state. */
	private elementActiveCount = new Map<string, number>();
	/**
	 * The index of the gamepad used for input.
	 * @remarks
	 * This value is set to 7 by default.
	 */
	public static readonly VIRTUAL_PAD_INDEX = 0x7ffffffe;
	public readonly gamepadIndex = OnscreenGamepad.VIRTUAL_PAD_INDEX;

	public get supportsVibrationEffect(): boolean {
		return typeof navigator !== 'undefined' && 'vibrate' in navigator;
	}

	public applyVibrationEffect(params: VibrationParams): void {
		if (!this.supportsVibrationEffect) return;
		const intensity = Math.max(0, Math.min(1, params.intensity ?? 1));
		const ms = Math.max(0, Math.round((params.duration ?? 0) * intensity));
		try { navigator.vibrate(ms); } catch { /* noop */ }
	}

	/**
	 * The state of each gamepad button for each player.
	 */
	private gamepadButtonStates: KeyOrButtonId2ButtonState = {};

	/**
	 * Hides the specified buttons.
	 * @param gamepad_button_ids An array of button names to hide.
	 * @throws Error if no HTML element is found matching a button name.
	 */
	public static hideButtons(gamepad_button_ids: string[]): void {
		gamepad_button_ids.forEach(b => {
			const elementId = OnscreenGamepad.ACTION_BUTTON_TO_ELEMENTID_MAP[b];
			if (!elementId) throw new Error(`Error while attempting to hide your buttons - no HTML elementID found matching button '${b}'.`);
			const element = document.getElementById(elementId);
			const textElement = document.getElementById(`${elementId}_text`);
			element?.classList.add('hidden');
			textElement?.classList.add('hidden');
		});
	}

	/**
	 * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
	 * @param btn - The index of the button to check the state of.
	 * @returns The pressed state of the button.
	 */
	public getButtonState(btn: string): ButtonState {
		const stateMap = this.gamepadButtonStates || {};
		return getPressedState(stateMap, btn);
	}

	/**
	 * Polls the input to update the button states and press times.
	 * Should be called once per frame to keep on-screen gamepad input in sync.
	 * Uses internal pointer-press counters, not DOM queries, for performance.
	 */
	public pollInput(): void {
		const defaultState = makeButtonState();
		const now = performance.now();
		const newStates: KeyOrButtonId2ButtonState = {};
		for (const button of Input.BUTTON_IDS) {
			const prev = this.gamepadButtonStates[button] ?? { ...defaultState };
			const count = this.activeCounts[button] ?? 0;
			const isDown = count > 0;
			if (isDown) {
				const just = !prev.pressed;
				newStates[button] = {
					...prev,
					pressed: true,
					justpressed: just,
					justreleased: false,
					presstime: (prev.presstime ?? 0) + 1,
					consumed: prev.consumed ?? false,
					timestamp: just ? now : (prev.timestamp ?? now),
					pressId: just ? ((prev.pressId ?? 0) + 1) : (prev.pressId ?? null),
					value: 1,
				};
			} else {
				const was = !!prev.pressed;
				newStates[button] = {
					...prev,
					pressed: false,
					justpressed: false,
					justreleased: was,
					presstime: 0,
					consumed: false,
					timestamp: now,
					value: 0,
				};
			}
		}
		this.gamepadButtonStates = newStates;
	}

		// Note: legacy DOM-scan helper removed; counters drive state now.

	/**
	 * Consumes the given button press for the specified player index.
	 * @param button The button to consume.
	 */
	public consumeButton(button: string) {
		if (!this.gamepadButtonStates[button]) this.gamepadButtonStates[button] = makeButtonState();
		this.gamepadButtonStates[button].consumed = true;
	}

	/**
	 * A mapping of directional pad (D-Pad) button combinations to their corresponding button arrays.
	 *
	 * Each key represents a specific D-Pad direction or combination, and the value is an object containing
	 * an array of buttons that are associated with that direction. The buttons are validated to be of type
	 * `BGamepadButton`.
	 */
	private static readonly DPAD_BUTTON_MAP: Record<string, { buttons: string[]; }> = {
		'd-pad-u': {
			buttons: ['up' satisfies BGamepadButton],
		},
		'd-pad-ru': {
			buttons: ['up' satisfies BGamepadButton, 'right' satisfies BGamepadButton],
		},
		'd-pad-r': {
			buttons: ['right' satisfies BGamepadButton],
		},
		'd-pad-rd': {
			buttons: ['right' satisfies BGamepadButton, 'down' satisfies BGamepadButton],
		},
		'd-pad-d': {
			buttons: ['down' satisfies BGamepadButton],
		},
		'd-pad-ld': {
			buttons: ['down' satisfies BGamepadButton, 'left' satisfies BGamepadButton],
		},
		'd-pad-l': {
			buttons: ['left' satisfies BGamepadButton],
		},
		'd-pad-lu': {
			buttons: ['left' satisfies BGamepadButton, 'up' satisfies BGamepadButton],
		},
	};

	/**
	 * A mapping of action buttons to their corresponding BGamepadButton representations.
	 *
	 * Each key in the ACTION_BUTTON_MAP represents a specific action button, and the value
	 * is an object containing an array of button identifiers that satisfy the BGamepadButton type.
	 *
	 * Note: Some buttons like 'lt_knop', 'rt_knop', and 'home_knop' are commented out and not currently in use.
	 */
	private static readonly ACTION_BUTTON_MAP: Record<string, { buttons: string[]; }> = {
		'a_knop': {
			buttons: ['a' satisfies BGamepadButton],
		},
		'b_knop': {
			buttons: ['b' satisfies BGamepadButton],
		},
		'x_knop': {
			buttons: ['x' satisfies BGamepadButton],
		},
		'y_knop': {
			buttons: ['y' satisfies BGamepadButton],
		},
		'ls_knop': {
			buttons: ['ls' satisfies BGamepadButton],
		},
		'rs_knop': {
			buttons: ['rs' satisfies BGamepadButton],
		},
		// 'lt_knop': {
		// 	buttons: ['lt' satisfies BGamepadButton],
		// },
		// 'rt_knop': {
		// 	buttons: ['rt' satisfies BGamepadButton],
		// },
		'select_knop': {
			buttons: ['select' satisfies BGamepadButton],
		},
		'start_knop': {
			buttons: ['start' satisfies BGamepadButton],
		},
		// 'home_knop': {
		//     buttons: ['home' satisfies BGamepadButton],
		// },
	};

	/**
	 * Maps action button names to corresponding element names.
	 * Used for hiding buttons at game start.
	 */
	private static readonly ACTION_BUTTON_TO_ELEMENTID_MAP: Record<string, string> = {
		'a': 'a_knop',
		'b': 'b_knop',
		'x': 'x_knop',
		'y': 'y_knop',
		'ls': 'ls_knop',
		'rs': 'rs_knop',
		'lt': 'lt_knop',
		'rt': 'rt_knop',
		'select': 'select_knop',
		'start': 'start_knop',
		// 'home': 'home_knop',
	};

	/**
	* Mapping of button names to their corresponding key inputs.
	*/
	private static readonly ALL_BUTTON_MAP: Record<string, { buttons: string[]; }> = {
		...OnscreenGamepad.DPAD_BUTTON_MAP,
		...OnscreenGamepad.ACTION_BUTTON_MAP,
	};

	/**
	 * A list of element IDs representing the directional pad (D-Pad) buttons.
	 */
	private static readonly DPAD_BUTTON_ELEMENT_IDS = Object.keys(OnscreenGamepad.DPAD_BUTTON_MAP);

	private static readonly ONSCREEN_BUTTON_ELEMENT_NAMES = Object.keys(OnscreenGamepad.ALL_BUTTON_MAP);

	/**
	 * Initializes the input system.
	 * Sets up event listeners for touch and mouse input,
	 * and resets the gamepad button states.
	 */
	public init(): void {
		// Reset gamepad button states
		this.reset();
		// Abort previous listeners, then create a new controller
		this.controller?.abort();
		this.controller = new AbortController();
		const signal = this.controller.signal;

		const addPointerListeners = (controlsElement: HTMLElement, action_type: 'dpad' | 'action') => {
			// Hint browsers: this region is interactive only
			try { controlsElement.style.touchAction = 'none'; } catch { console.info('Failed to set touch-action:none on onscreen gamepad controls element. This may affect touch input behavior, but I wouldn\'t worry about it.'); }
			controlsElement.addEventListener('pointerdown', e => { this.handlePointerDown(e as PointerEvent, action_type, controlsElement); return true; }, { ...options, signal });
			controlsElement.addEventListener('pointermove', e => { this.handlePointerMove(e as PointerEvent, action_type, controlsElement); return true; }, { ...options, signal });
			controlsElement.addEventListener('pointerup', e => { this.handlePointerUp(e as PointerEvent, action_type, controlsElement); return true; }, { ...options, signal });
			controlsElement.addEventListener('pointercancel', e => { this.handlePointerUp(e as PointerEvent, action_type, controlsElement); return true; }, { ...options, signal });
			controlsElement.addEventListener('lostpointercapture', e => { this.handlePointerUp(e as PointerEvent, action_type, controlsElement); return true; }, { ...options, signal });
		};

		const doc = typeof document !== 'undefined' ? document : null;
		const dPadControls = doc?.getElementById('d-pad-controls');
		const buttonControls = doc?.getElementById('button-controls');
		if (!(dPadControls instanceof HTMLElement) || !(buttonControls instanceof HTMLElement)) {
			throw new Error('[OnscreenGamepad] Required control elements not found.');
		}
		addPointerListeners(dPadControls, 'dpad');
		addPointerListeners(buttonControls, 'action');
		// No global touchstart preventDefault; rely on CSS touch-action and pointer capture.

		if (typeof window !== 'undefined') {
			window.addEventListener('blur', e => this.blur(e as FocusEvent), { signal });
			window.addEventListener('focus', e => this.focus(e as FocusEvent), { signal });
			window.addEventListener('mouseout', () => this.reset(), { ...options, signal });
		}
	}

	/** Convert a DOM id to base control id (strip _text suffix). */
	private baseId(id: string): string { return id?.endsWith('_text') ? id.slice(0, -5) : id; }

	/** Update UI class + dataset for element id based on active count. */
	private setElementActive(id: string, active: boolean): void {
		const el = document.getElementById(id);
		if (!el) return;
		el.dataset.touched = active ? 'true' : 'false';
		if (active) { el.classList.add('druk'); el.classList.remove('los'); }
		else { el.classList.remove('druk'); el.classList.add('los'); }
		// Mirror for button label if action button
		if (OnscreenGamepad.ACTION_BUTTON_MAP[id]) {
			const text = document.getElementById(`${id}_text`);
			if (text) {
				if (active) { text.classList.add('druk'); text.classList.remove('los'); }
				else { text.classList.remove('druk'); text.classList.add('los'); }
			}
		}
	}

	/** Apply dpad ring classes based on active dpad elements. */
	private updateDpadOmheining(): void {
		const ring = document.getElementById('d-pad-omheining') as HTMLElement | null;
		if (!ring) return;
		ring.classList.remove(...OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
		for (const id of OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS) {
			if ((this.elementActiveCount.get(id) ?? 0) > 0) ring.classList.add(id);
		}
	}

	/** Translate pointer position to active elements and logical buttons. */
	private hitTest(clientX: number, clientY: number, control_type: 'dpad' | 'action'): { elements: string[]; buttons: string[] } {
		const els = (document.elementsFromPoint(clientX, clientY) as HTMLElement[]) ?? [];
		for (const el of els) {
			const id = this.baseId(el.id);
			if (!id) continue;
			if (control_type === 'action' && OnscreenGamepad.ACTION_BUTTON_MAP[id]) {
				return { elements: [id], buttons: OnscreenGamepad.ACTION_BUTTON_MAP[id].buttons };
			}
			if (control_type === 'dpad' && OnscreenGamepad.DPAD_BUTTON_MAP[id]) {
				const neighbors: Record<string, string[]> = {
					'd-pad-lu': ['d-pad-u', 'd-pad-l'],
					'd-pad-u': ['d-pad-lu', 'd-pad-ru'],
					'd-pad-ru': ['d-pad-u', 'd-pad-r'],
					'd-pad-r': ['d-pad-ru', 'd-pad-rd'],
					'd-pad-ld': ['d-pad-d', 'd-pad-l'],
					'd-pad-d': ['d-pad-ld', 'd-pad-rd'],
					'd-pad-rd': ['d-pad-d', 'd-pad-r'],
					'd-pad-l': ['d-pad-lu', 'd-pad-ld'],
				};
				const elids = [id, ...(neighbors[id] ?? [])];
				return { elements: elids, buttons: OnscreenGamepad.DPAD_BUTTON_MAP[id].buttons };
			}
		}
		return { elements: [], buttons: [] };
	}

	private updateForPointer(pointerId: number, _control_type: 'dpad' | 'action', newElements: string[], newButtons: string[], captureEl: HTMLElement): void {
		// Previous sets
		const prevButtons = this.pointer2Buttons.get(pointerId) ?? new Set<string>();
		const prevElements = this.pointer2Elements.get(pointerId) ?? new Set<string>();

		// Diff buttons
		const newBtnSet = new Set(newButtons);
		for (const b of prevButtons) {
			if (!newBtnSet.has(b)) this.activeCounts[b] = Math.max(0, (this.activeCounts[b] ?? 0) - 1);
		}
		for (const b of newBtnSet) {
			if (!prevButtons.has(b)) this.activeCounts[b] = (this.activeCounts[b] ?? 0) + 1;
		}

		// Diff elements and update UI per-element reference counts
		const newElSet = new Set(newElements);
		for (const id of prevElements) {
			if (!newElSet.has(id)) {
				const n = (this.elementActiveCount.get(id) ?? 0) - 1;
				this.elementActiveCount.set(id, Math.max(0, n));
				if (n <= 1) this.setElementActive(id, false);
			}
		}
		for (const id of newElSet) {
			if (!prevElements.has(id)) {
				const n = (this.elementActiveCount.get(id) ?? 0) + 1;
				this.elementActiveCount.set(id, n);
				if (n === 1) this.setElementActive(id, true);
			}
		}
		this.updateDpadOmheining();

		// Persist new sets
		this.pointer2Buttons.set(pointerId, newBtnSet);
		this.pointer2Elements.set(pointerId, newElSet);

		// Capture pointer during interaction
		try { captureEl.setPointerCapture(pointerId); } catch { /* noop */ }
	}

	private handlePointerDown(e: PointerEvent, control_type: 'dpad' | 'action', host: HTMLElement): void {
		const hit = this.hitTest(e.clientX, e.clientY, control_type);
		this.updateForPointer(e.pointerId, control_type, hit.elements, hit.buttons, host);
	}

	private handlePointerMove(e: PointerEvent, control_type: 'dpad' | 'action', host: HTMLElement): void {
		if (e.pressure === 0 && e.buttons === 0) return; // ignore hover
		const hit = this.hitTest(e.clientX, e.clientY, control_type);
		this.updateForPointer(e.pointerId, control_type, hit.elements, hit.buttons, host);
	}

	private handlePointerUp(e: PointerEvent, _control_type: 'dpad' | 'action', host: HTMLElement): void {
		// Clear all state for this pointer
		const prevButtons = this.pointer2Buttons.get(e.pointerId) ?? new Set<string>();
		for (const b of prevButtons) this.activeCounts[b] = Math.max(0, (this.activeCounts[b] ?? 0) - 1);
		const prevElements = this.pointer2Elements.get(e.pointerId) ?? new Set<string>();
		for (const id of prevElements) {
			const n = (this.elementActiveCount.get(id) ?? 0) - 1;
			this.elementActiveCount.set(id, Math.max(0, n));
			if (n <= 1) this.setElementActive(id, false);
		}
		this.updateDpadOmheining();
		this.pointer2Buttons.delete(e.pointerId);
		this.pointer2Elements.delete(e.pointerId);
		try { host.releasePointerCapture(e.pointerId); } catch { /* noop */ }
	}

	/**
	 * Resets the state of all gamepad buttons.
	 * @param except An optional array of buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		if (!except) {
			// Initialize (or reinitialize) the states of all gamepad buttons and axes
			Input.BUTTON_IDS.forEach(buttonId => {
				this.gamepadButtonStates[buttonId] = makeButtonState();
			});
			// Clear runtime counters and UI state
			this.activeCounts = {};
			this.pointer2Buttons.clear();
			this.pointer2Elements.clear();
			this.elementActiveCount.clear();
			this.resetUI();
		}
		else {
			resetObject(this.gamepadButtonStates, except);
		}
	}

	/**
	 * Resets the state of all UI elements related to the gamepad this.
	 * This function is used to clear the state of all UI elements that represent the gamepad input buttons.
	 * It is called once per frame to ensure that the UI is up-to-date with the current gamepad input state.
	 */
	public resetUI(elementsToFilterById?: string[]): void {
		const resetElementAndButtonPress = (element_id: string): void => {
			const element = document.getElementById(element_id);
			if (element.classList.contains('druk')) {
				element.classList.remove('druk');
				element.classList.add('los');
				element.dataset.touched = 'false';

				const textElement = document.getElementById(`${element_id}_text`);
				if (textElement && textElement.classList.contains('druk')) {
					textElement.classList.remove('druk');
					textElement.classList.add('los');
				}
			}

		};

		if (elementsToFilterById) {
			OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.forEach(element => !elementsToFilterById.includes(element) && resetElementAndButtonPress(element));
		}
		else {
			OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.forEach(resetElementAndButtonPress);
		}
	}

	// Legacy touch handlers removed; pointer handlers are used instead.

	/**
	 * Handles the blur event for the input element.
	 * Resets the input state.
	 * @param _e - The blur event object.
	 */
	blur(_e: FocusEvent): void {
		this.reset();
	}

	/**
	 * Sets the focus on the element and resets its state.
	 * @param _e - The focus event.
	 */
	focus(_e: FocusEvent): void {
		this.reset();
	}

	/**
	 * Disposes of the input handler, cleaning up resources and event listeners.
	 */
	public dispose(): void {
		// Abort all listeners attached via this controller and reset state
		this.controller?.abort();
		this.controller = null;
		// Reset the gamepad button states
		this.reset();
	}
}
