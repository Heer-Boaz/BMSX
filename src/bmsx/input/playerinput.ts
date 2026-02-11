import { ActionDefinitionEvaluator } from './actionparser';
import { Input, InputStateManager, makeActionState, makeButtonState } from './input';
import type { ActionState, ActionStateQuery, BGamepadButton, ButtonId, ButtonState, GamepadBinding, GamepadInputMapping, InputHandler, InputMap, KeyboardBinding, KeyboardInputMapping, PointerBinding, PointerInputMapping, VibrationParams } from './inputtypes';
import { KeyboardInput } from './keyboardinput';
import { ContextStack, MappingContext } from './context';
import { $ } from '../core/engine_core';
import { clamp } from '../utils/clamp';
import { GAME_FPS } from '../rompack/rompack';
import { deep_clone } from '../utils/deep_clone';

const ACTION_GUARD_MIN_MS = 24;
const ACTION_GUARD_MAX_MS = 120;
const INITIAL_REPEAT_DELAY_FRAMES = 15;
const REPEAT_INTERVAL_FRAMES = 4;
const REPEAT_FRAME_MS = 1000 / GAME_FPS;
const INITIAL_REPEAT_DELAY_MS = INITIAL_REPEAT_DELAY_FRAMES * REPEAT_FRAME_MS;
const REPEAT_INTERVAL_MS = REPEAT_INTERVAL_FRAMES * REPEAT_FRAME_MS;

type ActionGuardRecord = {
	lastAcceptedAtMs: number;
	lastObservedTimestamp: number;
	lastResultAccepted: boolean;
	lastWindowMs: number;
	lastPressId: number;
};

type ActionRepeatRecord = {
	active: boolean;
	repeatCount: number;
	pressStartMs: number;
	lastFrameEvaluated: number;
	lastResult: boolean;
	lastRepeatAtMs: number;
};

type ActionBufferedEdgeFrameRecord = {
	frame: number;
	edgeId: number;
};

export const INPUT_SOURCES = ['keyboard', 'gamepad', 'pointer'] as const;
export type InputSource = typeof INPUT_SOURCES[number];

/** Bitwise flags representing keyboard modifier keys. */
export enum KeyModifier {
	none = 0,
	shift = 1 << 0,
	ctrl = 1 << 1,
	alt = 1 << 2,
	meta = 1 << 3,
}



/**
 * Represents the Input class responsible for handling user input.
 */
export class PlayerInput {
	/**
	 * Represents the input handlers for the player.
	 *
	 * @property {IInputHandler} keyboard - The handler for keyboard input, or null if not set.
	 * @property {IInputHandler} gamepad - The handler for gamepad input, or null if not set.
	 */
	public inputHandlers: { [source in InputSource]: InputHandler } = {
		keyboard: null,
		gamepad: null,
		pointer: null,
	};

	/** Manages buffered input events and button state aggregation. */
	private _stateManager: InputStateManager;

	/** Context stack for layered action maps */
	private contexts: ContextStack = new ContextStack();

	/** Pending rebind operation, if any */
	private pendingRebind: { action: string; source: InputSource; mode: 'append' | 'replace' } = null;

	private readonly actionGuardRecords: Map<string, ActionGuardRecord> = new Map();
	private readonly actionRepeatRecords: Map<string, ActionRepeatRecord> = new Map();
	private readonly actionPressRecords: Map<string, number> = new Map();
	private readonly actionReleaseRecords: Map<string, number> = new Map();
	private readonly actionBufferedPressFrameRecords: Map<string, ActionBufferedEdgeFrameRecord> = new Map();
	private readonly actionBufferedReleaseFrameRecords: Map<string, ActionBufferedEdgeFrameRecord> = new Map();
	private lastPollTimestampMs: number = null;
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
	 * @see {@link this.getActionState} and {@link this.checkActionTriggered} for checking if an action is pressed for a player.
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
	 * TODO: id unused (always defaults to 'base')
	 * TODO: priority unused (always defaults to 0)
	 */
	public setInputMap(inputMap: InputMap): void {
		if (!inputMap) throw new Error('[PlayerInput] Null or undefined input map provided.');
		inputMap.keyboard = inputMap.keyboard ?? this.inputMap?.keyboard ?? (this.playerIndex === 1 ? deep_clone(Input.DEFAULT_INPUT_MAPPING.keyboard) : {});
		inputMap.gamepad = inputMap.gamepad ?? this.inputMap?.gamepad ?? deep_clone(Input.DEFAULT_INPUT_MAPPING.gamepad);
		inputMap.pointer = inputMap.pointer ?? this.inputMap?.pointer ?? deep_clone(Input.DEFAULT_INPUT_MAPPING.pointer);
		this.inputMap = inputMap;

		// Mirror into a base context for layered merging semantics
		const base = new MappingContext('base', 0, true, inputMap.keyboard, inputMap.gamepad, inputMap.pointer);

		// Reset stack to base
		this.contexts = new ContextStack();
		this.contexts.push(base);
	}

	/** Add a higher-priority mapping context */
	public pushContext(id: string, keyboard: KeyboardInputMapping, gamepad: GamepadInputMapping, pointer: PointerInputMapping, priority = 100, enabled = true): void {
		this.contexts.push(new MappingContext(id, priority, enabled, keyboard ?? {}, gamepad ?? {}, pointer ?? {}));
	}

	public popContext(id?: string): void {
		this.contexts.pop(id);
	}

	public enableContext(id: string, enabled: boolean): void {
		this.contexts.enable(id, enabled);
	}

	public setContextPriority(id: string, priority: number): void {
		this.contexts.setPriority(id, priority);
	}

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
		const keyboardKeys: ButtonId[] = (keyboardKeysRaw && keyboardKeysRaw.length > 0)
			? keyboardKeysRaw.map(k => (typeof k === 'string' ? k : k.id))
			: null;
		const gamepadButtons: ButtonId[] = (gamepadButtonsRaw && gamepadButtonsRaw.length > 0)
			? gamepadButtonsRaw.map(b => (typeof b === 'string' ? b : b.id))
			: null;
		const pointerBindingsRaw = this.contexts.getBindings(action, 'pointer') as PointerBinding[];
		const pointerButtons: ButtonId[] = (pointerBindingsRaw && pointerBindingsRaw.length > 0)
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
			allPressed: boolean; anyPressed: boolean; anyJustPressed: boolean; allJustPressed: boolean;
			anyWasPressed: boolean; allWasPressed: boolean; anyJustReleased: boolean;
			allJustReleased: boolean; anyWasReleased: boolean; allWasReleased: boolean;
			anyConsumed: boolean; leastPressTime: number; recentestTimestamp: number;
			lastPressId: number; best1DVal: number; best1DAbs: number; best2DVal: [number, number]; best2DAbs: number;
			bufferPressId: number; bufferReleaseId: number;
		};
		// Aggregate a single action across multiple bindings (keyboard / gamepad / pointer).
		// Treat bindings as an OR: anyPressed drives `pressed`, while `all*` flags stay true only when every binding matches.
		// Track the freshest pressId so guardedjustpressed can distinguish a fresh edge even when multiple buttons map to one action.
		// More complex OR-of-AND expressions should use ActionDefinitionEvaluator (ActionParser); getActionState is the raw per-binding reader.
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
			let anyPressed = false;
			let leastPressTime: number = null;
			let recentestTimestamp: number = null;
			let lastPressId: number = null;
			let bufferPressId: number = null;
			let bufferReleaseId: number = null;
			let best1DVal: number = null; let best1DAbs = -Infinity;
			let best2DVal: [number, number] = null; let best2DAbs = -Infinity;

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
					if (state?.pressId != null && (state.justpressed || lastPressId === null || (state.timestamp != null && recentestTimestamp != null && state.timestamp >= recentestTimestamp))) {
						lastPressId = state.pressId;
					}
					const bufferedPress = this._stateManager.getLatestUnconsumedPressId(key);
					if (bufferedPress != null && (bufferPressId == null || bufferedPress > bufferPressId)) {
						bufferPressId = bufferedPress;
					}
					const bufferedRelease = this._stateManager.getLatestUnconsumedReleaseId(key);
					if (bufferedRelease != null && (bufferReleaseId == null || bufferedRelease > bufferReleaseId)) {
						bufferReleaseId = bufferedRelease;
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

			// Only consider anyJustReleased if none of the buttons are pressed, because if any button is pressed then the action is not just released
			anyJustReleased = anyJustReleased && !anyPressed;

			return { allPressed, anyPressed, anyJustPressed, allJustPressed, anyWasPressed, allWasPressed, anyJustReleased, allJustReleased, anyWasReleased, allWasReleased, anyConsumed, leastPressTime, recentestTimestamp, lastPressId, best1DVal, best1DAbs, best2DVal, best2DAbs, bufferPressId, bufferReleaseId };
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
		const pressed = deviceStates.some(state => state.anyPressed);
		let justpressed = deviceStates.some(state => state.anyJustPressed);
		const alljustpressed = deviceStates.some(state => state.allJustPressed);
		let justreleased = deviceStates.some(state => state.anyJustReleased);
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
		let merged1D: number = null;
		let best1DAbs = -Infinity;
		for (const state of deviceStates) {
			if (state.best1DAbs > best1DAbs) {
				best1DAbs = state.best1DAbs;
				merged1D = state.best1DVal;
			}
		}
		let merged2D: [number, number] = null;
		let best2DAbs = -Infinity;
		for (const state of deviceStates) {
			if (state.best2DAbs > best2DAbs) {
				best2DAbs = state.best2DAbs;
				merged2D = state.best2DVal;
			}
		}
		const minPresstime = minPresstimeRaw === Infinity ? null : minPresstimeRaw;

		let bufferedPressId: number = null;
		let bufferedReleaseId: number = null;
		for (const state of deviceStates) {
			if (state.bufferPressId != null && (bufferedPressId == null || state.bufferPressId > bufferedPressId)) {
				bufferedPressId = state.bufferPressId;
			}
			if (state.bufferReleaseId != null && (bufferedReleaseId == null || state.bufferReleaseId > bufferedReleaseId)) {
				bufferedReleaseId = state.bufferReleaseId;
			}
		}

		let pressId: number = null;
		let pressTimestamp: number = null;
		for (const state of deviceStates) {
			if (state.lastPressId == null || state.recentestTimestamp == null) continue;
			if (pressTimestamp == null || state.recentestTimestamp >= pressTimestamp) {
				pressTimestamp = state.recentestTimestamp;
				pressId = state.lastPressId;
			}
		}
		const lastBufferedPressId = this.actionPressRecords.get(action) ?? null;
		const bufferedPressFrameRecord = this.actionBufferedPressFrameRecords.get(action) ?? null;
		if (!justpressed &&
			bufferedPressFrameRecord != null &&
			bufferedPressFrameRecord.frame === this.frameCounter &&
			bufferedPressId != null &&
			bufferedPressFrameRecord.edgeId === bufferedPressId) {
			justpressed = true;
		}
		if (!justpressed && bufferedPressId != null && bufferedPressId !== lastBufferedPressId) {
			justpressed = true;
			this.actionBufferedPressFrameRecords.set(action, { frame: this.frameCounter, edgeId: bufferedPressId });
		}
		if (justpressed && bufferedPressId != null && (pressId == null || bufferedPressId > pressId)) {
			pressId = bufferedPressId;
		}
		if (justpressed && pressId != null) {
			this.actionPressRecords.set(action, pressId);
		}
		const lastBufferedReleaseId = this.actionReleaseRecords.get(action) ?? null;
		const bufferedReleaseFrameRecord = this.actionBufferedReleaseFrameRecords.get(action) ?? null;
		if (!justreleased &&
			bufferedReleaseFrameRecord != null &&
			bufferedReleaseFrameRecord.frame === this.frameCounter &&
			bufferedReleaseId != null &&
			bufferedReleaseFrameRecord.edgeId === bufferedReleaseId) {
			justreleased = true;
		}
		if (!justreleased && bufferedReleaseId != null && bufferedReleaseId !== lastBufferedReleaseId) {
			justreleased = true;
			this.actionBufferedReleaseFrameRecords.set(action, { frame: this.frameCounter, edgeId: bufferedReleaseId });
		}
		if (justreleased && bufferedReleaseId != null && bufferedReleaseId !== lastBufferedReleaseId) {
			this.actionReleaseRecords.set(action, bufferedReleaseId);
		}

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
			pressId,
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
	 * @deprecated Prefer {@link checkActionTriggered} with an ActionParser definition to query actions.
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
			if (source === 'keyboard') {
				const keysOrButtons: KeyboardBinding[] = inputMap.keyboard?.[action] ?? [];
				for (const binding of keysOrButtons) {
					const key = typeof binding === 'string' ? binding : binding.id;
					const buttonState = this.getButtonState(key, 'keyboard');
					if (buttonState.pressed && !buttonState.consumed) {
						this.consumeButton(key, 'keyboard');
					}
				}
			} else if (source === 'gamepad') {
				const keysOrButtons: GamepadBinding[] = inputMap.gamepad?.[action] ?? [];
				for (const binding of keysOrButtons) {
					const key = typeof binding === 'string' ? binding : binding.id;
					const buttonState = this.getButtonState(key, 'gamepad');
					if (buttonState?.pressed && !buttonState.consumed) {
						this.consumeButton(key, 'gamepad');
					}
				}
			} else if (source === 'pointer') {
				const keysOrButtons: PointerBinding[] = inputMap.pointer?.[action] ?? [];
				for (const binding of keysOrButtons) {
					const key = typeof binding === 'string' ? binding : binding.id;
					const buttonState = this.getButtonState(key, 'pointer');
					if (buttonState?.pressed && !buttonState.consumed) {
						this.consumeButton(key, 'pointer');
					}
				}
			}
		}
	}

	public consumeButton(button: ButtonId, source: InputSource): void {
		const handler = this.inputHandlers[source];
		if (!handler) return;
		const state = handler.getButtonState(button);
		handler.consumeButton(button);
		this._stateManager.consumeBufferedEvent(button, state?.pressId);
	}

	public consumeActions(...actions: (ActionState | string)[]): void {
		actions.forEach(action => this.consumeAction(action));
	}

	public getModifiersState(): { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean } {
		const keyboardHandler = this.inputHandlers['keyboard'];
		if (!keyboardHandler) return { shift: false, ctrl: false, alt: false, meta: false };

		const ctrl = keyboardHandler.getButtonState('ControlLeft')?.pressed === true || keyboardHandler.getButtonState('ControlRight')?.pressed === true;
		const alt = keyboardHandler.getButtonState('AltLeft')?.pressed === true || keyboardHandler.getButtonState('AltRight')?.pressed === true;
		const shift = keyboardHandler.getButtonState('ShiftLeft')?.pressed === true || keyboardHandler.getButtonState('ShiftRight')?.pressed === true;
		const meta = keyboardHandler.getButtonState('MetaLeft')?.pressed === true || keyboardHandler.getButtonState('MetaRight')?.pressed === true;
		return { shift, ctrl, alt, meta };
	}

	/** Returns current pressed modifiers as a bitmask composed of KeyModifier flags. */
	public getModifiersMask(): KeyModifier {
		const { shift, ctrl, alt, meta } = this.getModifiersState();
		let mask: KeyModifier = KeyModifier.none;
		if (shift) mask |= KeyModifier.shift;
		if (ctrl) mask |= KeyModifier.ctrl;
		if (alt) mask |= KeyModifier.alt;
		if (meta) mask |= KeyModifier.meta;
		return mask;
	}

	/** Utility to expand a KeyModifier mask back into an object form. */
	public static modifiersFromMask(mask: KeyModifier): { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean } {
		return {
			shift: (mask & KeyModifier.shift) !== 0,
			ctrl: (mask & KeyModifier.ctrl) !== 0,
			alt: (mask & KeyModifier.alt) !== 0,
			meta: (mask & KeyModifier.meta) !== 0,
		};
	}

	/**
	 * Retrieves the state of a gamepad button.
	 * @param button - The gamepad button identifier.
	 * @returns The state of the button.
	 */
	public getButtonState(button: ButtonId, source: InputSource): ButtonState {
		const handler = this.inputHandlers[source];
		if (!handler) return makeButtonState();
		return handler.getButtonState(button);
	}

	public get pollFrame(): number {
		return this.frameCounter;
	}

	/** Returns repeat/edge info for a raw button using the built-in repeat cadence. */
	public getButtonRepeatState(button: ButtonId, source: InputSource): ButtonState {
		const state = this.getButtonState(button, source);
		const repeatKey = `${source}:${button}`;
		const actionState = makeActionState(repeatKey, state);
		const repeat = this.evaluateActionRepeat(repeatKey, actionState);
		actionState.repeatcount = repeat.count;
		actionState.repeatpressed = repeat.triggered;
		return actionState;
	}

	public getKeyState(key: ButtonId, modifiers: KeyModifier): ButtonState {
		const state = this.getButtonState(key, 'keyboard');
		// If no modifiers are required, return the state as is
		if (modifiers === KeyModifier.none) return state;

		// Check the current state of each modifier key
		const { shift, ctrl, alt, meta } = PlayerInput.modifiersFromMask(modifiers);
		const modState = this.getModifiersState();

		// Verify that the current modifier states match the required modifiers
		if ((shift && !modState.shift) ||
			(ctrl && !modState.ctrl) ||
			(alt && !modState.alt) ||
			(meta && !modState.meta)) {
			// If any required modifier is not active, return a non-pressed state
			return makeButtonState();
		}

		return state;
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
		if (this.lastPollTimestampMs > 0) {
			const delta = currentTime - this.lastPollTimestampMs;
			// Guard window follows the observed poll cadence so justpressed remains reliable even if frame timing shifts.
			this.guardWindowMs = clamp(delta, ACTION_GUARD_MIN_MS, ACTION_GUARD_MAX_MS);
		}
		this.lastPollTimestampMs = currentTime;

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
		let capturedKb: string = null;
		let capturedGp: BGamepadButton = null;
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

		// Guard is per-action and per-pressId: if the same press has already been accepted this frame,
		// let it through so multi-binding combos don't suppress fresh edges. Use this for one-shots; raw justpressed stays unguarded.
		const timestamp = this.resolveActionTimestamp(state);
		const guardMs = this.normalizeGuardWindow(windowOverride);
		const existing = this.actionGuardRecords.get(action);
		// If the same pressId already passed the guard this frame, don't re-block duplicates from multi-binding combos.
		const pressId = state.pressId;
		if (existing) {
			if (existing.lastPressId !== null && pressId !== null && existing.lastPressId === pressId) {
				return existing.lastResultAccepted;
			}
			if (existing.lastObservedTimestamp === timestamp && existing.lastWindowMs === guardMs) {
				return existing.lastResultAccepted;
			}
		}

		const previousAcceptedAt = existing?.lastAcceptedAtMs
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
			lastPressId: pressId,
		};
		this.actionGuardRecords.set(action, nextRecord);
		return accepted;
	}

	private normalizeGuardWindow(windowOverride?: number): number {
		if (windowOverride >= 0) {
			return clamp(windowOverride, ACTION_GUARD_MIN_MS, ACTION_GUARD_MAX_MS);
		}
		return this.guardWindowMs;
	}

	private resolveActionTimestamp(state: ActionState): number {
		if (state.timestamp) {
			return state.timestamp;
		}
		if (state.pressedAtMs) {
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
		const pressed = state.pressed === true;
		const justpressed = state.justpressed === true;
		const now = this.lastPollTimestampMs ?? $.platform.clock.now();
		const startMs = state.pressedAtMs ?? state.timestamp ?? now;
		const initialDelayMs = INITIAL_REPEAT_DELAY_MS;
		const repeatIntervalMs = REPEAT_INTERVAL_MS;

		if (justpressed) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.pressStartMs = startMs;
			repeat.lastRepeatAtMs = startMs;
			result = true;
		} else if (!pressed) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.pressStartMs = -1;
			repeat.lastRepeatAtMs = -1;
		} else {
			if (!repeat.active) {
				repeat.active = true;
				repeat.repeatCount = 0;
				repeat.pressStartMs = startMs;
				repeat.lastRepeatAtMs = startMs;
			}
			if (repeat.pressStartMs < 0) {
				repeat.pressStartMs = startMs;
			}
			const nextAt = repeat.repeatCount === 0
				? repeat.pressStartMs + initialDelayMs
				: repeat.lastRepeatAtMs + repeatIntervalMs;
			if (now >= nextAt) {
				repeat.repeatCount += 1;
				repeat.lastRepeatAtMs = nextAt;
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
				pressStartMs: -1,
				lastFrameEvaluated: -1,
				lastResult: false,
				lastRepeatAtMs: -1,
			};
			this.actionRepeatRecords.set(action, entry);
		}
		return entry;
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

	/** Clears cached transition state so edge detectors don't fire spuriously. */
	public clearEdgeState(): void {
		this._stateManager.resetEdgeState();
		this.actionBufferedPressFrameRecords.clear();
		this.actionBufferedReleaseFrameRecords.clear();
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
		this.actionPressRecords.clear();
		this.actionReleaseRecords.clear();
		this.actionBufferedPressFrameRecords.clear();
		this.actionBufferedReleaseFrameRecords.clear();
		this.lastPollTimestampMs = null;
		this.guardWindowMs = ACTION_GUARD_MIN_MS;
		this.frameCounter = 0;
	}
}
