import { ActionDefinitionEvaluator } from './actionparser';
import { Input, InputStateManager, makeActionState, makeButtonState } from './input';
import type { ActionState, ActionStateQuery, BGamepadButton, ButtonId, ButtonState, GamepadBinding, GamepadInputMapping, InputHandler, InputMap, KeyboardBinding, KeyboardInputMapping, PointerBinding, PointerInputMapping, VibrationParams } from './inputtypes';
import { KeyboardInput } from './keyboardinput';
import { ContextStack, MappingContext } from './context';
import { $ } from '../core/game';
import { clamp } from '../utils/utils';

const ACTION_GUARD_MIN_MS = 24;
const ACTION_GUARD_MAX_MS = 120;
const INITIAL_REPEAT_DELAY_FRAMES = 15;
const REPEAT_INTERVAL_FRAMES = 4;

type ActionGuardRecord = {
	lastAcceptedAtMs: number;
	lastObservedTimestamp: number;
	lastResultAccepted: boolean;
	lastWindowMs: number;
};

type ActionRepeatRecord = {
	active: boolean;
	repeatCount: number;
	pressStartFrame: number;
	lastFrameEvaluated: number;
	lastResult: boolean;
	hasDispatchedThisCycle: boolean;
};

export const INPUT_SOURCES = ['keyboard', 'gamepad', 'pointer'] as const;
export type InputSource = typeof INPUT_SOURCES[number];

/**
 * Represents the Input class responsible for handling user input.
 */
export class PlayerInput {
	/**
	 * Represents the input handlers for the player.
	 *
	 * @property {IInputHandler | null} keyboard - The handler for keyboard input, or null if not set.
	 * @property {IInputHandler | null} gamepad - The handler for gamepad input, or null if not set.
	 */
	public inputHandlers: { [source in InputSource]: InputHandler | null } = {
		keyboard: null,
		gamepad: null,
		pointer: null,
	};


	/** Manages buffered input events and button state aggregation. */
	private _stateManager: InputStateManager;

	/** Context stack for layered action maps */
	private contexts: ContextStack = new ContextStack();

	/** Pending rebind operation, if any */
	private pendingRebind: { action: string; source: InputSource; mode: 'append' | 'replace' } | null = null;

	private readonly actionGuardRecords: Map<string, ActionGuardRecord> = new Map();
	private readonly actionRepeatRecords: Map<string, ActionRepeatRecord> = new Map();
	private lastPollTimestampMs: number | null = null;
	private guardWindowMs: number = ACTION_GUARD_MIN_MS;
	private frameCounter = 0;

	/**
	 * Indicates whether the player is the main player.
	 * Currently used for determining whether to assign the on-screen gamepad automatically if any other assigned gamepad is disconnected.
	 * @returns {boolean} True if the player is the main player, false otherwise.
	 */
	/**
	 * The input maps for each player.
	 * @private
	 * @param {number} playerIndex - The index of the player to set the input map for.
	 * @param {InputMap} inputMap - The input map to set for the player.
	 * @returns {void}
	 * @throws {Error} Throws an error if the player index is out of range.
	 * @throws {Error} Throws an error if the input map is invalid.
	 * @see {@link this.getActionState} and {@link this.getPressedActions} for checking if an action is pressed for a player.
	 * @example
	 * this.setInputMap(0, {
	 *     keyboard: {
	 *         'jump': ['Space'],
	 *         'left': ['ArrowLeft'],
	 *         'right': ['ArrowRight'],
	 *         'up': ['ArrowUp'],
	 *         'down': ['ArrowDown'],
	 *    	   'jumpleft': ['ArrowLeft', 'Space'],
	 *	       'jumpright': ['ArrowRight', 'Space'],
	 *     },
	 *     gamepad: {
	 *         'jump': ['a'],
	 *         'left': ['left'],
	 *         'right': ['right'],
	 *         'up': ['up'],
	 *         'down': ['down'],
	 *		   'jumpleft': ['left', 'a'],
	 *		   'jumpright': ['right', 'a'],
	 *     },
	 * });
	 */
	public inputMap: InputMap;

	/**
	 * Checks if all actions defined in the action definition string have been triggered.
	 * Supports both AND (•) and OR (+) operators.
	 * @param actionDefinition The action definition string to check.
	 * @returns True if the action definition is satisfied, false otherwise.
	 */
	public checkActionTriggered(actionDefinition: string): boolean {
		// Validate referenced action names exist in current mappings to catch typos or missing bindings early
		const referenced = ActionDefinitionEvaluator.getReferencedActions(actionDefinition);
		if (referenced.length > 0) {
			const missing: string[] = [];
			for (const name of referenced) {
				// Ask the context stack whether any bindings exist for this action across sources
				const kb = this.contexts.getBindings(name, 'keyboard');
				const gp = this.contexts.getBindings(name, 'gamepad');
				const ptr = this.contexts.getBindings(name, 'pointer');
				if ((!kb || kb.length === 0) && (!gp || gp.length === 0) && (!ptr || ptr.length === 0)) missing.push(name);
			}
			if (missing.length > 0) throw new Error(`[PlayerInput] Action definition references unknown actions: ${missing.join(', ')}`);
		}
		return ActionDefinitionEvaluator.checkActionTriggered(actionDefinition, this.getActionState.bind(this));
	}

	public checkActionsTriggered(...actions: { id: string; def: string; }[]): string[] {
		return actions.filter(action => this.checkActionTriggered(action.def)).map(action => action.id);
	}

	public get stateManager(): InputStateManager {
		return this._stateManager;
	}

	/**
	 * Sets the input map for a specific player.
	 * @param inputMap - The input map to set.
	 */
	public setInputMap(inputMap: InputMap): void {
		this.inputMap = inputMap;
		// Mirror into a base context for layered merging semantics
		const base = new MappingContext('base', 0, true, inputMap.keyboard ?? {}, inputMap.gamepad ?? {}, inputMap.pointer ?? {});
		// Reset stack to base
		this.contexts = new ContextStack();
		this.contexts.push(base);
	}

	/** Add a higher-priority mapping context */
	public pushContext(id: string, keyboard: KeyboardInputMapping | undefined, gamepad: GamepadInputMapping | undefined, pointer: PointerInputMapping | undefined, priority = 100, enabled = true): void {
		this.contexts.push(new MappingContext(id, priority, enabled, keyboard ?? {}, gamepad ?? {}, pointer ?? {}));
	}
	public popContext(id?: string): void { this.contexts.pop(id); }
	public enableContext(id: string, enabled: boolean): void { this.contexts.enable(id, enabled); }
	public setContextPriority(id: string, priority: number): void { this.contexts.setPriority(id, priority); }

	public get supportsVibrationEffect(): boolean {
		for (const source of INPUT_SOURCES) {
			if (this.inputHandlers[source]?.supportsVibrationEffect) return true;
		}
		return false;
	}

	public applyVibrationEffect(params: VibrationParams): void {
		for (const source of INPUT_SOURCES) {
			if (!this.inputHandlers[source]?.supportsVibrationEffect) continue;
			this.inputHandlers[source]!.applyVibrationEffect(params);
		}
	}

	/**
	 * Retrieves the state of an action.
	 *
	 * @param action - The name of the action.
	 * @param framewindow - An optional time window in milliseconds to consider for the action state. **Note: This doesn't really work as it should! For instance, if you press the directional button to move left, it will make the action state for 'left' always pressed, even if you release the button, until the time window expires.
	 * @returns The state of the action, including whether it is pressed, consumed, the press time, and the timestamp.
	 */
	public getActionState(action: string, framewindow: number = null): ActionState {
		const inputMap = this.inputMap;
		if (!inputMap) return makeActionState(action);

		const keyboardKeysRaw = this.contexts.getBindings(action, 'keyboard');
		const gamepadButtonsRaw = this.contexts.getBindings(action, 'gamepad');
		const keyboardKeys: ButtonId[] | null = (keyboardKeysRaw && keyboardKeysRaw.length > 0)
			? keyboardKeysRaw.map(k => (typeof k === 'string' ? k : k.id))
			: null;
		const gamepadButtons: ButtonId[] | null = (gamepadButtonsRaw && gamepadButtonsRaw.length > 0)
			? gamepadButtonsRaw.map(b => (typeof b === 'string' ? b : b.id))
			: null;
		const pointerBindingsRaw = this.contexts.getBindings(action, 'pointer') as PointerBinding[];
		const pointerButtons: ButtonId[] | null = (pointerBindingsRaw && pointerBindingsRaw.length > 0)
			? pointerBindingsRaw.map(b => (typeof b === 'string' ? b : b.id))
			: null;

		/**
		 * Retrieves the state of the specified action, which can be a combination of keyboard keys or gamepad buttons or a single key/button.
		 *
		 * @param keys_or_buttons - An array of keys or button identifiers that make up the action.
		 * @param getStateFunc - A function that takes a button identifier and returns its state.
		 * @returns An object containing:
		 *  - `allPressed`: A boolean indicating if all specified keys/buttons are currently pressed.
		 *  - `anyConsumed`: A boolean indicating if any of the specified keys/buttons have been consumed.
		 *  - `anyJustPressed`: A boolean indicating if any of the specified keys/buttons were just pressed in the current frame, but only if all are pressed.
		 *  - `allJustPressed`: A boolean indicating if all specified keys/buttons were just pressed in the current frame.
		 *  - `leastPressTime`: The minimum press time among the specified keys/buttons, or `null` if none are pressed.
		 *  - `recentestTimestamp`: The maximum timestamp among the specified keys/buttons, or `null` if none are pressed.
		 */
		type Agg = {
			allPressed: boolean; anyJustPressed: boolean; allJustPressed: boolean;
			anyWasPressed: boolean; allWasPressed: boolean; anyJustReleased: boolean;
			allJustReleased: boolean; anyWasReleased: boolean; allWasReleased: boolean;
			anyConsumed: boolean; leastPressTime: number | null; recentestTimestamp: number | null;
			best1DVal: number | null; best1DAbs: number; best2DVal: [number, number] | null; best2DAbs: number;
		};
		const getStates = (keys_or_buttons: ButtonId[], getStateFunc: (key: ButtonId, framewindow?: number) => ButtonState): Agg => {
			let allPressed = true;
			let allJustPressed = true;
			let anyJustPressed = false;
			let allJustReleased = true;
			let anyJustReleased = false;
			let allWasPressed = true;
			let anyWasPressed = false;
			let anyWasReleased = false;
			let allWasReleased = true;
			let anyConsumed = false;
			let anyPressed: boolean = false; // To track if any button is pressed, specifically needed for the anyJustReleased
			let leastPressTime: number | null = null;
			let recentestTimestamp: number | null = null;
			let best1DVal: number | null = null; let best1DAbs = -Infinity;
			let best2DVal: [number, number] | null = null; let best2DAbs = -Infinity;

			if (keys_or_buttons && keys_or_buttons.length > 0) {
				for (const key of keys_or_buttons) {
					const state = getStateFunc(key, framewindow);
					allPressed = allPressed && (state?.pressed ?? false);
					anyPressed = anyPressed || (state?.pressed ?? false);
					allJustPressed = allJustPressed && (state?.justpressed ?? false);
					anyJustPressed = anyJustPressed || (state?.justpressed ?? false);
					allJustReleased = allJustReleased && (state?.justreleased ?? false);
					anyJustReleased = anyJustReleased || (state?.justreleased ?? false);
					allWasPressed = allWasPressed && (state?.waspressed ?? false);
					anyWasPressed = anyWasPressed || (state?.waspressed ?? false);
					allWasReleased = allWasReleased && (state?.wasreleased ?? false);
					anyWasReleased = anyWasReleased || (state?.wasreleased ?? false);
					anyConsumed = anyConsumed || (state?.consumed ?? false);
					if (state && state.presstime != null) {
						leastPressTime = (leastPressTime == null) ? state.presstime : Math.min(leastPressTime, state.presstime);
					}
					if (state && state.timestamp != null) {
						recentestTimestamp = (recentestTimestamp == null) ? state.timestamp : Math.max(recentestTimestamp, state.timestamp);
					}
					if (typeof state?.value === 'number') {
						const abs = Math.abs(state.value);
						if (abs > best1DAbs) { best1DAbs = abs; best1DVal = state.value; }
					}
					if (state?.value2d) {
						const [vx, vy] = state.value2d;
						const mag = Math.hypot(vx, vy);
						if (mag > best2DAbs) { best2DAbs = mag; best2DVal = [vx, vy]; }
					}
				}
			} else {
				allPressed = allJustPressed = allWasPressed = allJustReleased = anyWasReleased = allJustReleased = false;
				leastPressTime = recentestTimestamp = null;
			}

			// Only consider anyJustPressed if all buttons are pressed, because if any button is not pressed then the action is not just pressed
			anyJustPressed = anyJustPressed && allPressed;
			// Only consider anyJustReleased if none of the buttons are pressed, because if any button is pressed then the action is not just released
			anyJustReleased = anyJustReleased && !anyPressed;

			return { allPressed, anyJustPressed, allJustPressed, anyWasPressed, allWasPressed, anyJustReleased, allJustReleased, anyWasReleased, allWasReleased, anyConsumed, leastPressTime, recentestTimestamp, best1DVal, best1DAbs, best2DVal, best2DAbs };
		};

		const keyboardState = getStates(
			keyboardKeys,
			(key: ButtonId, framewindow?: number) => framewindow !== null
				? this._stateManager.getButtonState(key, framewindow)
				: this.getButtonState(key, 'keyboard')
		);
		const gamepadState = getStates(
			gamepadButtons,
			(button: ButtonId, framewindow?: number) => framewindow !== null
				? this._stateManager.getButtonState(button, framewindow)
				: this.getButtonState(button, 'gamepad')
		);
		const pointerState = getStates(
			pointerButtons,
			(button: ButtonId) => this.getButtonState(button, 'pointer')
		);
		const deviceStates = [keyboardState, gamepadState, pointerState];
		const pressed = deviceStates.some(state => state.allPressed);
		const justpressed = deviceStates.some(state => state.anyJustPressed);
		const alljustpressed = deviceStates.some(state => state.allJustPressed);
		const justreleased = deviceStates.some(state => state.anyJustReleased);
		const alljustreleased = deviceStates.some(state => state.allJustReleased);
		const waspressed = deviceStates.some(state => state.anyWasPressed);
		const wasreleased = deviceStates.some(state => state.anyWasReleased);
		const allwaspressed = deviceStates.some(state => state.allWasPressed);
		const consumed = deviceStates.some(state => state.anyConsumed);
		const minPresstimeRaw = deviceStates
			.map(state => state.leastPressTime)
			.filter((value): value is number => value != null)
			.reduce((min, value) => Math.min(min, value), Infinity);
		const maxTimestamp = deviceStates
			.map(state => state.recentestTimestamp)
			.filter((value): value is number => value != null)
			.reduce((max, value) => Math.max(max, value), -Infinity);
		let merged1D: number | null = null;
		let best1DAbs = -Infinity;
		for (const state of deviceStates) {
			if (state.best1DAbs > best1DAbs) {
				best1DAbs = state.best1DAbs;
				merged1D = state.best1DVal ?? null;
			}
		}
		let merged2D: [number, number] | null = null;
		let best2DAbs = -Infinity;
		for (const state of deviceStates) {
			if (state.best2DAbs > best2DAbs) {
				best2DAbs = state.best2DAbs;
				merged2D = state.best2DVal ?? null;
			}
		}
		const minPresstime = minPresstimeRaw === Infinity ? null : minPresstimeRaw;

		const timestamp = maxTimestamp === -Infinity ? null : maxTimestamp;
		const result: ActionState = {
			action,
			pressed,
			justpressed,
			alljustpressed,
			justreleased,
			alljustreleased,
			waspressed,
			wasreleased,
			allwaspressed,
			consumed,
			presstime: minPresstime,
			timestamp,
			value: typeof merged1D === 'number' ? merged1D : null,
			value2d: merged2D,
			guardedjustpressed: false,
			repeatpressed: false,
			repeatcount: 0,
		};

		const guarded = this.evaluateActionGuard(action, result);
		const repeat = this.evaluateActionRepeat(action, result);
		result.guardedjustpressed = guarded;
		result.repeatpressed = repeat.triggered;
		result.repeatcount = repeat.count;

		return result;
	}

	/**
	 * Returns all actions that have been pressed for a given player index.
	 * Retrieves an array of pressed ActionStates based on the provided filter.
	 * If no filter is provided, all pressed ActionStates are returned.
	 * if `actionsByPriority` is given, it retrieves the priority actions for a given player index based on the action priority list.
	 * @param filter - An optional array of strings representing the actions to filter.
	 * @returns An array of pressed ActionStates.
	 */
	public getPressedActions(query?: ActionStateQuery): ActionState[] {
		const inputMap = this.inputMap;

		const pressedActions: ActionState[] = [];
		const seen = new Set<string>();
		// Iterate over all input sources (keyboard, gamepad, pointer)
		for (const source of INPUT_SOURCES) {
			const bindings = source === 'keyboard'
				? inputMap.keyboard
				: source === 'gamepad'
					? inputMap.gamepad
					: inputMap.pointer;
			if (!bindings) continue;
			for (const action in bindings) {
				if (seen.has(action)) continue;
				if (query?.filter && !query.filter.includes(action)) continue; // Skip actions that are not in the filter
				const actionState = this.getActionState(action);
				// Check if the just pressed state matches the query, but only if the query explicitly specifies that justPressed should be true
				const justPressedMatches = (query?.justPressed === true)
					? actionState.justpressed === true
					: true;
				// Check if the consumed state matches the query, but only if the query explicitly specifies that consumed should be false
				const consumedMatches = (query?.consumed === false)
					? actionState.consumed === false
					: true;
				if (actionState.pressed === (query?.pressed ?? true) &&
					justPressedMatches &&
					consumedMatches &&
					((actionState.presstime ?? 0) >= (query?.pressTime ?? 0))) {
					pressedActions.push(actionState);
					seen.add(action);
				}
			}
		}

		if (query?.actionsByPriority) {
			const priorityActions: ActionState[] = [];
			for (const priorityAction of query.actionsByPriority) {
				const actionObject = pressedActions.find(action => action.action === priorityAction);

				if (actionObject) {
					priorityActions.push(actionObject);
				}
			}
			return priorityActions;
		}

		return pressedActions;
	}

	/**
	 * Consumes the input action for the specified player index.
	 * @param actionToConsume The name of the input action to consume.
	 */
	public consumeAction(actionToConsume: ActionState | string) {
		const inputMap = this.inputMap;
		if (!inputMap) return;

		// Determine the action string
		const action: string = (typeof actionToConsume === 'string') ? actionToConsume : actionToConsume.action;

		for (const source of INPUT_SOURCES) {
			const handler = this.inputHandlers[source];
			if (!handler) continue;
			if (source === 'keyboard') {
				const keysOrButtons: KeyboardBinding[] = inputMap.keyboard?.[action] ?? [];
				for (const binding of keysOrButtons) {
					const key = typeof binding === 'string' ? binding : binding.id;
					const buttonState = handler.getButtonState(key);
					if (buttonState.pressed && !buttonState.consumed) {
						handler.consumeButton(key);
					}
					this._stateManager.consumeBufferedEvent(key, buttonState.pressId ?? undefined);
				}
			} else if (source === 'gamepad') {
				const keysOrButtons: GamepadBinding[] = inputMap.gamepad?.[action] ?? [];
				for (const binding of keysOrButtons) {
					const key = typeof binding === 'string' ? binding : binding.id;
					const buttonState = handler.getButtonState(key);
					if (buttonState.pressed && !buttonState.consumed) {
						handler.consumeButton(key);
					}
					this._stateManager.consumeBufferedEvent(key, buttonState.pressId ?? undefined);
				}
			} else if (source === 'pointer') {
				const keysOrButtons: PointerBinding[] = inputMap.pointer?.[action] ?? [];
				for (const binding of keysOrButtons) {
					const key = typeof binding === 'string' ? binding : binding.id;
					const buttonState = handler.getButtonState(key);
					if (buttonState.pressed && !buttonState.consumed) {
						handler.consumeButton(key);
					}
					this._stateManager.consumeBufferedEvent(key, buttonState.pressId ?? undefined);
				}
			}
		}
	}

	/**
	 * Consumes a list of actions.
	 *
	 * @param actions - The actions to consume.
	 */
	public consumeActions(...actions: (ActionState | string)[]) {
		actions.forEach(action => this.consumeAction(action));
	}

	/**
	 * Retrieves the state of a gamepad button.
	 * @param button - The gamepad button identifier.
	 * @returns The state of the button.
	 */
	public getButtonState(button: ButtonId, source: InputSource): ButtonState {
		if (source === 'keyboard' && !this.isKeyboardConnected()) return null;
		if (source === 'gamepad' && !this.isGamepadConnected()) return null;
		if (source === 'pointer' && !this.isPointerConnected()) return null;
		return this.inputHandlers[source].getButtonState(button);
	}

	/**
	 * Checks if a specific button on a gamepad is currently being pressed down.
	 * @param button - The gamepad button to check.
	 * @returns A boolean indicating whether the button is currently pressed down.
	 */
	public isButtonDown(button: ButtonId, source: InputSource): boolean {
		const buttonState = this.getButtonState(button, source);
		return buttonState?.pressed; // Use optional chaining to avoid errors as a button might not be registered on an e.g. disconnected gamepad
	}

	/**
	 * Checks if a key or gamepad button is pressed and consumes the input if it is.
	 * @param key - The key to check.
	 * @param button - The gamepad button to check (optional).
	 * @returns `true` if the input was consumed, `false` otherwise.
	 */
	public checkAndConsume(key: ButtonId, button?: ButtonId): boolean {
		const keyState = this.inputHandlers['keyboard']?.getButtonState(key) ?? makeButtonState();

		if (keyState.pressed && !keyState.consumed) {
			this.inputHandlers['keyboard'].consumeButton(key);
			return true;
		}

		if (button !== undefined && this.isGamepadConnected()) {
			const buttonState = this.getButtonState(button, 'gamepad');
			if (buttonState.pressed && !buttonState.consumed) {
				this.inputHandlers['gamepad'].consumeButton(button);
				return true;
			}
		}

		return false;
	}

	/**
	* Assigns a gamepad to a player and returns the player index.
	* If no player index is available, returns null.
	* @param gamepad The gamepad to assign to a player.
	* @returns The player index the gamepad was assigned to, or null if no player index was available.
	*/
	assignGamepadToPlayer(gamepadInput: InputHandler): void {
		if (this.inputHandlers['gamepad'] && this.inputHandlers['gamepad'] !== gamepadInput) {
			console.warn(`Replacing existing gamepad for player ${this.playerIndex} with gamepad ${gamepadInput.gamepadIndex}.`);
			this.inputHandlers['gamepad']?.reset();
		}
		this.inputHandlers['gamepad'] = gamepadInput;
		console.info(`Gamepad ${gamepadInput.gamepadIndex} assigned to player ${this.playerIndex}.`);
	}

	public clearGamepad(handler: InputHandler): void {
		if (this.inputHandlers['gamepad'] !== handler) return;
		this.inputHandlers['gamepad'] = null;
		handler.reset();
	}

	/**
	 * Polls the input for the player for each input source (e.g., keyboard, gamepad, ...)
	 */
	pollInput(currentTime: number): void {
		this.frameCounter += 1;
		if (Number.isFinite(currentTime)) {
			if (this.lastPollTimestampMs !== null) {
				const delta = currentTime - this.lastPollTimestampMs;
				if (Number.isFinite(delta) && delta > 0) {
					this.guardWindowMs = clamp(delta, ACTION_GUARD_MIN_MS, ACTION_GUARD_MAX_MS);
				}
			}
			this.lastPollTimestampMs = currentTime;
		}

		this._stateManager.beginFrame(currentTime);
		for (const source of INPUT_SOURCES) {
			const handler = this.inputHandlers[source];
			if (!handler) continue;
			handler.pollInput();
		}
		this.processPendingRebind();
	}

	private processPendingRebind(): void {
		if (!this.pendingRebind) return;
		const { action, source, mode } = this.pendingRebind;
		const handler = this.inputHandlers[source];
		if (!handler) return;
		let capturedKb: string | null = null;
		let capturedGp: BGamepadButton | null = null;
		if (source === 'gamepad') {
			for (const button of Input.BUTTON_IDS) {
				const st = handler.getButtonState(button);
				if (st?.justpressed) { capturedGp = button; break; }
			}
		} else if (handler instanceof KeyboardInput) {
			for (const key of Object.keys(handler.keyStates)) {
				const st = handler.getButtonState(key);
				if (st?.justpressed) { capturedKb = key; break; }
			}
		}
		if (capturedKb === null && capturedGp === null) return;
		if (capturedKb !== null) {
			const id = capturedKb;
			const arr = this.inputMap.keyboard[action] ?? [];
			const exists = arr.some(b => (typeof b === 'string' ? b : b.id) === id);
			const base = mode === 'replace'
				? []
				: exists
					? arr.filter(b => (typeof b === 'string' ? b : b.id) !== id)
					: arr.slice();
			base.push(id);
			this.inputMap.keyboard[action] = base;
			for (const act of Object.keys(this.inputMap.keyboard)) {
				if (act === action) continue;
				const list = this.inputMap.keyboard[act] ?? [];
				this.inputMap.keyboard[act] = list.filter(b => (typeof b === 'string' ? b : b.id) !== id);
			}
		}
		if (capturedGp !== null) {
			const id = capturedGp;
			const arr = this.inputMap.gamepad[action] ?? [];
			const exists = arr.some(b => (typeof b === 'string' ? b : b.id) === id);
			const base = mode === 'replace'
				? []
				: exists
					? arr.filter(b => (typeof b === 'string' ? b : b.id) !== id)
					: arr.slice();
			base.push(id);
			this.inputMap.gamepad[action] = base;
			for (const act of Object.keys(this.inputMap.gamepad)) {
				if (act === action) continue;
				const list = this.inputMap.gamepad[act] ?? [];
				this.inputMap.gamepad[act] = list.filter(b => (typeof b === 'string' ? b : b.id) !== id);
			}
		}
		this.pendingRebind = null;
	}

	private evaluateActionGuard(action: string, state: ActionState, windowOverride?: number): boolean {
		if (state.justpressed !== true) {
			return false;
		}

		const timestamp = this.resolveActionTimestamp(state);
		const guardMs = this.normalizeGuardWindow(windowOverride);
		const existing = this.actionGuardRecords.get(action);
		if (existing && existing.lastObservedTimestamp === timestamp && existing.lastWindowMs === guardMs) {
			return existing.lastResultAccepted;
		}

		const previousAcceptedAt = existing && Number.isFinite(existing.lastAcceptedAtMs)
			? existing.lastAcceptedAtMs
			: null;
		let accepted = true;
		if (previousAcceptedAt !== null) {
			const delta = timestamp - previousAcceptedAt;
			if (Number.isFinite(delta) && delta <= guardMs) {
				accepted = false;
			}
		}

		const nextRecord: ActionGuardRecord = {
			lastAcceptedAtMs: accepted ? timestamp : (previousAcceptedAt ?? timestamp),
			lastObservedTimestamp: timestamp,
			lastResultAccepted: accepted,
			lastWindowMs: guardMs,
		};
		this.actionGuardRecords.set(action, nextRecord);
		return accepted;
	}

	private normalizeGuardWindow(windowOverride?: number): number {
		if (typeof windowOverride === 'number' && Number.isFinite(windowOverride) && windowOverride > 0) {
			return clamp(windowOverride, ACTION_GUARD_MIN_MS, ACTION_GUARD_MAX_MS);
		}
		return this.guardWindowMs;
	}

	private resolveActionTimestamp(state: ActionState): number {
		if (typeof state.timestamp === 'number' && Number.isFinite(state.timestamp)) {
			return state.timestamp;
		}
		if (typeof state.pressedAtMs === 'number' && Number.isFinite(state.pressedAtMs)) {
			return state.pressedAtMs;
		}
		if (this.lastPollTimestampMs !== null) {
			return this.lastPollTimestampMs;
		}
		return $.platform.clock.now();
	}

	private evaluateActionRepeat(action: string, state: ActionState): { triggered: boolean; count: number } {
		const repeat = this.ensureRepeatState(action);
		if (repeat.lastFrameEvaluated === this.frameCounter) {
			return { triggered: repeat.lastResult, count: repeat.repeatCount };
		}

		let result = false;

		if (state.justpressed === true) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = true;
			repeat.pressStartFrame = this.frameCounter;
			result = true;
		} else if (state.pressed !== true && state.justreleased === true && !repeat.hasDispatchedThisCycle) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = true;
			repeat.pressStartFrame = -1;
			result = true;
		} else if (state.pressed !== true) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = false;
			repeat.pressStartFrame = -1;
		} else {
			if (!repeat.active) {
				repeat.active = true;
				repeat.repeatCount = 0;
				repeat.pressStartFrame = this.frameCounter;
			}
			if (repeat.pressStartFrame < 0) {
				repeat.pressStartFrame = this.frameCounter;
			}
			const heldFrames = this.frameCounter - repeat.pressStartFrame;
			if (heldFrames < 0) {
				throw new Error(`[PlayerInput] Negative held frame count detected for action ${action}.`);
			}
			const repeatsElapsed = this.computeRepeatCount(heldFrames);
			if (repeatsElapsed > repeat.repeatCount) {
				repeat.repeatCount = repeatsElapsed;
				repeat.hasDispatchedThisCycle = true;
				result = true;
			}
		}

		repeat.lastFrameEvaluated = this.frameCounter;
		repeat.lastResult = result;
		return { triggered: result, count: repeat.repeatCount };
	}

	private ensureRepeatState(action: string): ActionRepeatRecord {
		let entry = this.actionRepeatRecords.get(action);
		if (!entry) {
			entry = {
				active: false,
				repeatCount: 0,
				pressStartFrame: -1,
				lastFrameEvaluated: -1,
				lastResult: false,
				hasDispatchedThisCycle: false,
			};
			this.actionRepeatRecords.set(action, entry);
		}
		return entry;
	}

	private computeRepeatCount(heldFrames: number): number {
		if (heldFrames < 0) {
			throw new Error('[PlayerInput] Held frame count cannot be negative.');
		}
		if (heldFrames < INITIAL_REPEAT_DELAY_FRAMES) {
			return 0;
		}
		const elapsedSinceDelay = heldFrames - INITIAL_REPEAT_DELAY_FRAMES;
		return Math.floor(elapsedSinceDelay / REPEAT_INTERVAL_FRAMES) + 1;
	}

	/** Updates aggregated button states and cleans up stale events. */
	update(currentTime: number): void {
		this._stateManager.update(currentTime);
	}

	/**
	 * Initializes the input system.
	 */
	public constructor(public playerIndex: number) {
		this._stateManager = new InputStateManager();
		this.inputHandlers['gamepad'] = null;
		this.reset();
	}

	/**
	 * Checks if a keyboard is connected for the specified player index.
	 * @returns True if a keyboard is connected for the specified player index, false otherwise.
	 */
	private isKeyboardConnected(): boolean {
		return this.inputHandlers['keyboard'] !== null;
	}

	/**
	 * Checks if a gamepad is connected for the specified player index.
	 * @returns True if a gamepad is connected for the specified player index, false otherwise.
	 */
	private isGamepadConnected(): boolean {
		return this.inputHandlers['gamepad'] !== null;
	}

	private isPointerConnected(): boolean {
		return this.inputHandlers['pointer'] !== null;
	}

	/** Clears cached transition state so edge detectors don't fire spuriously. */
	public clearEdgeState(): void {
		this._stateManager.resetEdgeState();
	}

	/**
	 * Resets the state of all input keys and gamepad buttons.
	 * @param except An optional array of keys or buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		this.clearEdgeState();
		for (const source of INPUT_SOURCES) {
			this.inputHandlers[source]?.reset(except);
		}
		this.actionGuardRecords.clear();
		this.actionRepeatRecords.clear();
		this.lastPollTimestampMs = null;
		this.guardWindowMs = ACTION_GUARD_MIN_MS;
		this.frameCounter = 0;
	}
}
