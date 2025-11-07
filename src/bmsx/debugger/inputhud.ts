import { Registry } from '../core/registry';
import { EventEmitter, subscribesToGlobalEvent } from '../core/eventemitter';
import { excludeclassfromsavegame } from '../serializer/serializationhooks';
import { attachHudPanel, makeHudPanelDraggable } from './hudpanel';
import { $ } from '../core/game';
import { Input } from '../input/input';
import type { InputMap, ButtonState, ActionState, BGamepadButton, KeyboardButton } from '../input/inputtypes';
import { OnscreenGamepad } from '../input/onscreengamepad';

const HUD_ID = 'bmsx-input-hud';

function ensureHudElement(): HTMLElement {
	let el = document.getElementById(HUD_ID);
	if (!el) {
		el = document.createElement('div');
		el.id = HUD_ID;
		el.style.padding = '6px 8px';
		el.style.font = '12px/1.2 monospace';
		el.style.background = 'rgba(0,0,0,0.55)';
		el.style.color = '#cce';
		el.style.pointerEvents = 'auto';
		el.style.zIndex = '9001';
		el.style.borderRadius = '4px';
		el.style.maxWidth = '50vw';
		el.style.whiteSpace = 'pre';
		const header = document.createElement('div');
		header.style.display = 'flex';
		header.style.justifyContent = 'space-between';
		header.style.alignItems = 'center';
		header.style.fontWeight = 'bold';
		header.style.marginBottom = '4px';
		header.style.userSelect = 'none';
		const title = document.createElement('span');
		title.textContent = 'Input HUD';
		const buttons = document.createElement('span');
		const btnMin = document.createElement('span');
		btnMin.textContent = '–';
		btnMin.title = 'Minimize';
		btnMin.style.cursor = 'pointer';
		btnMin.style.marginRight = '8px';
		const btnClose = document.createElement('span');
		btnClose.textContent = '×';
		btnClose.title = 'Close';
		btnClose.style.cursor = 'pointer';
		buttons.appendChild(btnMin);
		buttons.appendChild(btnClose);
		const content = document.createElement('div');
		content.id = HUD_ID + '-content';
		header.appendChild(title);
		header.appendChild(buttons);
		el.appendChild(header);
		el.appendChild(content);
		attachHudPanel(el, 'top-left');
		makeHudPanelDraggable(el, header);
		let collapsed = false;
		btnMin.addEventListener('click', ev => {
			ev.stopPropagation();
			collapsed = !collapsed;
			content.style.display = collapsed ? 'none' : '';
			btnMin.textContent = collapsed ? '+' : '–';
		});
		btnClose.addEventListener('click', ev => { ev.stopPropagation(); overlay?.disable(); });
	}
	return el;
}

function flag(cond: boolean, char: string): string {
	return cond ? char : '.';
}

function flagsToString(state: ActionState | ButtonState): string {
	const justpressed = state.justpressed;
	const hold = state.pressed && state.presstime >= 1;
	const justpressedOrHoldFlag = justpressed ? 'j' : (hold ? 'h' : '.');
	return `${flag(state.pressed, 'p')}${justpressedOrHoldFlag}${flag(state.justreleased, 'r')}${flag(state.consumed, 'c')}`;
}

function formatButtonState(label: string, state: ButtonState | null): string | null {
	if (!state) return null;
	const interesting = state.pressed || state.justpressed || state.justreleased || state.consumed;
	if (!interesting) return null;
	const flags = flagsToString(state);
	let suffix = '';
	if (state.value !== null && state.value !== undefined) suffix = ` val=${state.value.toFixed(2)}`;
	else if (state.value2d) suffix = ` val2d=(${state.value2d[0].toFixed(2)},${state.value2d[1].toFixed(2)})`;
	return `${label}:${flags}${suffix}`;
}

function formatActionState(state: ActionState): string {
	const flags = flagsToString(state);
	const hold = (state.pressed && state.presstime !== null)
		? ` ${Math.round(state.presstime).toString().padStart(4, ' ')}frames`
		: ''.padStart(12, ' ');
	return `${state.action.padEnd(20)} ${flags}${hold}`;
}

function extractMappings(map: InputMap | undefined): {
	actions: string[];
	keyboardKeys: string[];
	gamepadButtons: string[];
	pointerButtons: string[];
} {
	const actions = new Set<string>();
	const keyboard = new Set<string>();
	const gamepad = new Set<string>();
const pointer = new Set<string>();
	if (map) {
		for (const action of Object.keys(map.keyboard ?? {})) {
			actions.add(action);
			for (const binding of map.keyboard[action] ?? []) keyboard.add(typeof binding === 'string' ? binding : binding.id);
		}
		for (const action of Object.keys(map.gamepad ?? {})) {
			actions.add(action);
			for (const binding of map.gamepad[action] ?? []) gamepad.add(typeof binding === 'string' ? binding : binding.id);
		}
		for (const action of Object.keys(map.pointer ?? {})) {
			actions.add(action);
			for (const binding of map.pointer?.[action] ?? []) pointer.add(typeof binding === 'string' ? binding : binding.id);
		}
	}
	return {
		actions: Array.from(actions).sort((a, b) => a.localeCompare(b)),
		keyboardKeys: Array.from(keyboard).sort((a, b) => a.localeCompare(b)),
		gamepadButtons: Array.from(gamepad).sort((a, b) => a.localeCompare(b)),
		pointerButtons: Array.from(pointer).sort((a, b) => a.localeCompare(b)),
	};
}

@excludeclassfromsavegame
export class InputHUDOverlay {
	public get id(): string { return 'input-hud-overlay'; }
	public get registrypersistent(): true { return true; }
	public enabled = false;

	constructor() {
		Registry.instance.register(this);
	}

	public dispose(): void {
		EventEmitter.instance.removeSubscriber(this);
		const el = document.getElementById(HUD_ID);
		if (!el) return;
		const parent = el.parentElement;
		if (!parent) throw new Error('[InputHUD] HUD element is detached from the DOM, cannot dispose cleanly.');
		parent.removeChild(el);
		this.enabled = false;
	}

	@subscribesToGlobalEvent('frameend', true)
	updateNow(): void {
		if (!this.enabled) return;
		const hud = ensureHudElement();
		const contentEl = document.getElementById(HUD_ID + '-content');
		if (!contentEl) throw new Error('[InputHUD] HUD content element is missing.');
		const inputSvc = $.input;
		if (!inputSvc) throw new Error('[InputHUD] Input service is not registered.');

		const blocks: string[] = [];
		for (let i = 1; i <= Input.PLAYERS_MAX; i++) {
			const playerInput = inputSvc.getPlayerInput(i);
			const inputMap = playerInput.inputMap;
			const keyboardHandler = playerInput.inputHandlers['keyboard'];
			const gamepadHandler = playerInput.inputHandlers['gamepad'];
			const pointerHandler = playerInput.inputHandlers['pointer'];
			const hasKeyboard = keyboardHandler != null;
			const hasGamepad = gamepadHandler != null;
			const hasPointer = pointerHandler != null;
			const hasOnscreenGamepad = hasGamepad && gamepadHandler.gamepadIndex === OnscreenGamepad.VIRTUAL_PAD_INDEX;
			const header = `Player ${i}  k:${hasKeyboard ? '✓' : '–'}  g:${hasGamepad ? '✓' : '–'}  p:${hasPointer ? '✓' : '–'}  o:${hasOnscreenGamepad ? '✓' : '–'}`;
			const lines: string[] = [header];
			const { actions, keyboardKeys, gamepadButtons, pointerButtons } = extractMappings(inputMap);
			if (!hasKeyboard && !hasGamepad && actions.length === 0) continue;

			const keyboardStates: string[] = [];
			for (const key of keyboardKeys) {
				const state = playerInput.getButtonState(key as KeyboardButton, 'keyboard');
				const txt = formatButtonState(key, state);
				if (txt) keyboardStates.push(txt);
			}
			if (keyboardStates.length) lines.push('  Keys: ' + keyboardStates.join('\n'));

			const gamepadStates: string[] = [];
			for (const button of gamepadButtons) {
				const state = playerInput.getButtonState(button as BGamepadButton, 'gamepad');
				const txt = formatButtonState(button, state);
				if (txt) gamepadStates.push(txt);
			}
			if (gamepadStates.length) lines.push('  Buttons: ' + gamepadStates.join('\n'));

			const pointerStates: string[] = [];
			for (const button of pointerButtons) {
				const state = playerInput.getButtonState(button, 'pointer');
				const txt = formatButtonState(button, state);
				if (txt) pointerStates.push(txt);
			}
			const pointerPositionState = playerInput.getButtonState('pointer_position', 'pointer');
			const pointerPosTxt = formatButtonState('pointer_position', pointerPositionState);
			if (pointerPosTxt) pointerStates.push(pointerPosTxt);
			const pointerDeltaState = playerInput.getButtonState('pointer_delta', 'pointer');
			const pointerDeltaTxt = formatButtonState('pointer_delta', pointerDeltaState);
			if (pointerDeltaTxt) pointerStates.push(pointerDeltaTxt);
			const pointerWheelState = playerInput.getButtonState('pointer_wheel', 'pointer');
			const pointerWheelTxt = formatButtonState('pointer_wheel', pointerWheelState);
			if (pointerWheelTxt) pointerStates.push(pointerWheelTxt);
			if (pointerStates.length) lines.push('  Pointer: ' + pointerStates.join('\n'));

			if (actions.length) {
				lines.push('  Actions:');
				for (const action of actions) {
					const st = playerInput.getActionState(action);
					lines.push('    ' + formatActionState(st));
				}
			} else {
				lines.push('  (no bound actions)');
			}

			blocks.push(lines.join('\n'));
		}

		contentEl.textContent = blocks.join('\n\n');
		hud.style.display = 'block';
	}

	enable(): void { this.enabled = true; ensureHudElement().style.display = 'block'; this.updateNow(); }
	disable(): void {
		this.enabled = false;
		const el = document.getElementById(HUD_ID);
		if (!el) throw new Error('[InputHUD] disable() called before HUD element was created.');
		el.style.display = 'none';
	}

	public bind(): void { EventEmitter.instance.initClassBoundEventSubscriptions(this); }
	public unbind(): void { EventEmitter.instance.removeSubscriber(this); }
}

const overlay: InputHUDOverlay | null = typeof document === 'undefined' ? null : new InputHUDOverlay();
if (overlay) overlay.bind();

export function toggleInputHUD(): void {
	if (!overlay) return;
	if (overlay.enabled) overlay.disable();
	else overlay.enable();
}
