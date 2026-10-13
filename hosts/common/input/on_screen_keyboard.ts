import { Input } from './manager';
import { INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT } from '../../../machine/ts/machine/devices/input/contracts';
import {
	KeyboardPage, OnScreenKeyboardCommand, ON_SCREEN_KEY_DEFINITIONS, ON_SCREEN_KEY_INDEX_BY_CODE,
	type OnScreenKeyboardPage, type OnScreenKeyboardRow, MODIFIER_CODES, MODIFIER_KEY_INDICES, MODIFIER_SHIFT, NO_MODIFIER,
} from './on_screen_keyboard_keys';

const RELEASE_FEEDBACK_MS = 120;

/** Virtual keyboard source lifetimes, independent of bitmap or browser geometry. */
export class OnScreenKeyboard {
	public static readonly POINTER_SOURCE = Input.PLAYERS_MAX * INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
	public static readonly INITIAL_SOURCE_COUNT = OnScreenKeyboard.POINTER_SOURCE + 1;
	private sourceCount = OnScreenKeyboard.INITIAL_SOURCE_COUNT;
	private sourceKeys = new Int16Array(this.sourceCount).fill(-1);
	private sourceModifiers = new Uint8Array(this.sourceCount);
	private sourceModifierTapEligible = new Uint8Array(this.sourceCount);
	private sourceModifierTapGeneration = new Float64Array(this.sourceCount);
	private ordinaryHeldSources = 0;
	private ordinaryPressGeneration = 0;
	private readonly keyCounts = new Uint32Array(ON_SCREEN_KEY_DEFINITIONS.length);
	private readonly modifierCounts = new Uint32Array(MODIFIER_CODES.length);
	private readonly modifierStates = [false, false, false];
	private readonly modifierPressed = [false, false, false];
	private readonly feedbackUntilMs = new Float64Array(ON_SCREEN_KEY_DEFINITIONS.length);
	private feedbackTimeMs = 0;
	private nextFeedbackExpiryMs = Infinity;
	private currentPage = KeyboardPage.Text;
	private selected: number;
	private selectedRow: number;
	private readonly pageSelections: number[];
	private readonly pageKeyRows: Int16Array[] = [];
	private readonly pageKeyCenters: Float64Array[] = [];
	private opened = false;
	private changeRevision = 0;
	private readonly listeners: Array<(() => void) | null> = [];

	public constructor(private readonly input: Input, private readonly pages: readonly OnScreenKeyboardPage[]) {
		this.pageSelections = pages.map(page => page.initialKey);
		for (const page of pages) {
			let maxUnits = 0;
			for (const row of page.rows) maxUnits = Math.max(maxUnits, row.units);
			const keyRows = new Int16Array(ON_SCREEN_KEY_DEFINITIONS.length);
			const keyCenters = new Float64Array(ON_SCREEN_KEY_DEFINITIONS.length);
			for (let rowIndex = 0; rowIndex < page.rows.length; rowIndex += 1) {
				const row = page.rows[rowIndex];
				let units = 0;
				for (let column = 0; column < row.keys.length; column += 1) {
					const key = row.keys[column];
					keyRows[key] = rowIndex;
					keyCenters[key] = maxUnits - row.units + units * 2 + row.spans[column];
					units += row.spans[column];
				}
			}
			this.pageKeyRows.push(keyRows);
			this.pageKeyCenters.push(keyCenters);
		}
		this.selected = this.pageSelections[KeyboardPage.Text];
		this.selectedRow = this.pageKeyRows[this.currentPage][this.selected];
	}
	public get page(): KeyboardPage { return this.currentPage; }
	public get rows(): readonly OnScreenKeyboardRow[] { return this.pages[this.currentPage].rows; }
	public get selectedKey(): number { return this.selected; }
	public get visible(): boolean { return this.opened; }
	public get revision(): number { return this.changeRevision; }
	public get shiftActive(): boolean { return this.modifierPressed[MODIFIER_SHIFT]; }

	public subscribe(listener: () => void): () => void {
		let slot = this.listeners.indexOf(null);
		if (slot < 0) slot = this.listeners.length;
		this.listeners[slot] = listener;
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners[slot] = null;
		};
	}

	/** Browser contact records retain/reuse these slots; capacity grows only at a new high-water mark. */
	public allocateSource(): number {
		if (this.sourceCount === this.sourceKeys.length) {
			const keys = new Int16Array(this.sourceKeys.length * 2).fill(-1);
			keys.set(this.sourceKeys);
			this.sourceKeys = keys;
			const modifiers = new Uint8Array(keys.length);
			modifiers.set(this.sourceModifiers);
			this.sourceModifiers = modifiers;
			const eligible = new Uint8Array(keys.length);
			eligible.set(this.sourceModifierTapEligible);
			this.sourceModifierTapEligible = eligible;
			const generations = new Float64Array(keys.length);
			generations.set(this.sourceModifierTapGeneration);
			this.sourceModifierTapGeneration = generations;
		}
		return this.sourceCount++;
	}

	public open(): void {
		this.opened = true;
		this.currentPage = KeyboardPage.Text;
		for (let page = 0; page < this.pages.length; page += 1) this.pageSelections[page] = this.pages[page].initialKey;
		this.selected = this.pageSelections[this.currentPage];
		this.selectedRow = this.pageKeyRows[this.currentPage][this.selected];
		this.feedbackUntilMs.fill(0);
		this.nextFeedbackExpiryMs = Infinity;
		this.changed();
	}

	public close(): void {
		for (let source = 0; source < this.sourceCount; source += 1) this.releaseKeySource(source);
		for (let modifier = 0; modifier < MODIFIER_CODES.length; modifier += 1) {
			this.modifierStates[modifier] = false;
			this.publishModifier(modifier);
		}
		this.opened = false;
		this.feedbackUntilMs.fill(0);
		this.nextFeedbackExpiryMs = Infinity;
		this.changed();
	}

	public setPage(page: KeyboardPage): void {
		if (page === this.currentPage) return;
		this.currentPage = page;
		this.selected = this.pageSelections[page];
		this.selectedRow = this.pageKeyRows[this.currentPage][this.selected];
		this.changed();
	}

	public selectKey(key: number, page = this.currentPage): void {
		if (this.pageSelections[page] === key) return;
		this.pageSelections[page] = key;
		if (page === this.currentPage) {
			this.selected = key;
			this.selectedRow = this.pageKeyRows[this.currentPage][key];
		}
		this.changed();
	}

	public moveHorizontal(direction: number): void {
		const row = this.pages[this.currentPage].rows[this.selectedRow];
		const offset = row.keys.indexOf(this.selected);
		this.selectKey(row.keys[(offset + row.keys.length + direction) % row.keys.length]);
	}

	public moveVertical(direction: number): void {
		const rows = this.pages[this.currentPage].rows;
		const centers = this.pageKeyCenters[this.currentPage];
		const currentCenter = centers[this.selected];
		const rowIndex = (this.selectedRow + rows.length + direction) % rows.length;
		const row = rows[rowIndex];
		let closest = row.keys[0];
		let closestDistance = Math.abs(centers[closest] - currentCenter);
		for (let index = 1; index < row.keys.length; index += 1) {
			const key = row.keys[index];
			const distance = Math.abs(centers[key] - currentCenter);
			if (distance < closestDistance) { closest = key; closestDistance = distance; }
		}
		this.selectKey(closest);
	}

	/** Sticky activation remains available to gamepad/mouse users. Touch uses pressKey instead. */
	public activate(source: number): void { this.activateKey(source, this.selected); }
	public activateKey(source: number, key: number): void {
		const modifier = ON_SCREEN_KEY_DEFINITIONS[key].modifier;
		if (modifier === NO_MODIFIER) { this.pressKey(source, key); return; }
		this.modifierStates[modifier] = !this.modifierStates[modifier];
		this.publishModifier(modifier);
		this.changed();
	}

	/** A source transition releases its old key, then retains the newly pressed exact key identity. */
	public pressKey(source: number, key: number): void {
		if (this.sourceKeys[source] === key) return;
		this.releaseKeySource(source);
		this.sourceKeys[source] = key;
		const definition = ON_SCREEN_KEY_DEFINITIONS[key];
		if (definition.modifier !== NO_MODIFIER) {
			this.sourceModifierTapEligible[source] = this.ordinaryHeldSources === 0 ? 1 : 0;
			this.sourceModifierTapGeneration[source] = this.ordinaryPressGeneration;
			this.keyCounts[key] += 1;
			this.publishModifier(definition.modifier);
		} else {
			this.ordinaryHeldSources += 1;
			this.ordinaryPressGeneration += 1;
			let modifiers = 0;
			for (let modifier = 0; modifier < MODIFIER_CODES.length; modifier += 1) {
				if (this.modifierStates[modifier]) { modifiers |= 1 << modifier; this.modifierCounts[modifier] += 1; }
			}
			this.sourceModifiers[source] = modifiers;
			if (++this.keyCounts[key] === 1) {
				this.input.setVirtualKeyboardKey(definition.code, true);
				this.recordKeyFeedback(key, true);
			}
		}
		this.changed();
	}

	/** Only an actual native UP can complete an unused held-modifier tap as a sticky latch. */
	public releaseSource(source: number, completeModifierTap = false): void {
		const key = this.sourceKeys[source];
		if (completeModifierTap && key >= 0 && this.sourceModifierTapEligible[source] !== 0
			&& this.sourceModifierTapGeneration[source] === this.ordinaryPressGeneration) {
			const modifier = ON_SCREEN_KEY_DEFINITIONS[key].modifier;
			this.modifierStates[modifier] = !this.modifierStates[modifier];
		}
		if (this.releaseKeySource(source)) this.changed();
	}

	public command(source: number, command: OnScreenKeyboardCommand): void {
		switch (command) {
			case OnScreenKeyboardCommand.None: return;
			case OnScreenKeyboardCommand.Activate: this.activate(source); return;
			case OnScreenKeyboardCommand.Shift: this.activateKey(source, MODIFIER_KEY_INDICES[MODIFIER_SHIFT]); return;
			case OnScreenKeyboardCommand.TogglePage: this.setPage((this.currentPage + 1) % this.pages.length); return;
			case OnScreenKeyboardCommand.Backspace: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('Backspace')); return;
			case OnScreenKeyboardCommand.Delete: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('Delete')); return;
			case OnScreenKeyboardCommand.Space: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('Space')); return;
			case OnScreenKeyboardCommand.Left: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('ArrowLeft')); return;
			case OnScreenKeyboardCommand.Right: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('ArrowRight')); return;
			case OnScreenKeyboardCommand.Home: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('Home')); return;
			case OnScreenKeyboardCommand.End: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('End')); return;
			case OnScreenKeyboardCommand.Enter: this.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get('Enter')); return;
		}
	}

	public label(key: number): string {
		const definition = ON_SCREEN_KEY_DEFINITIONS[key];
		return this.shiftActive && definition.shiftLabel !== undefined ? definition.shiftLabel : definition.label;
	}
	public isKeyPressed(key: number): boolean {
		const modifier = ON_SCREEN_KEY_DEFINITIONS[key].modifier;
		return modifier === NO_MODIFIER ? this.keyCounts[key] !== 0 : this.modifierPressed[modifier];
	}
	public isKeyHighlighted(key: number): boolean { return this.isKeyPressed(key) || this.feedbackUntilMs[key] !== 0; }

	/** Feedback deadlines affect presentation only, never input lifetime. */
	public updateFeedback(currentTimeMs: number): void {
		this.feedbackTimeMs = currentTimeMs;
		if (currentTimeMs < this.nextFeedbackExpiryMs) return;
		let nextExpiry = Infinity;
		for (let key = 0; key < this.feedbackUntilMs.length; key += 1) {
			const expiry = this.feedbackUntilMs[key];
			if (expiry <= currentTimeMs) this.feedbackUntilMs[key] = 0;
			else nextExpiry = Math.min(nextExpiry, expiry);
		}
		this.nextFeedbackExpiryMs = nextExpiry;
		this.changed();
	}

	private releaseKeySource(source: number): boolean {
		const key = this.sourceKeys[source];
		if (key < 0) return false;
		this.sourceKeys[source] = -1;
		this.sourceModifierTapEligible[source] = 0;
		const definition = ON_SCREEN_KEY_DEFINITIONS[key];
		this.keyCounts[key] -= 1;
		if (definition.modifier !== NO_MODIFIER) this.publishModifier(definition.modifier);
		else {
			this.ordinaryHeldSources -= 1;
			if (this.keyCounts[key] === 0) {
				this.input.setVirtualKeyboardKey(definition.code, false);
				this.recordKeyFeedback(key, false);
			}
		}
		const modifiers = this.sourceModifiers[source];
		this.sourceModifiers[source] = 0;
		for (let modifier = 0; modifier < MODIFIER_CODES.length; modifier += 1) {
			if ((modifiers & (1 << modifier)) === 0) continue;
			this.modifierCounts[modifier] -= 1;
			if (modifier === MODIFIER_SHIFT && this.modifierCounts[modifier] === 0) this.modifierStates[modifier] = false;
			this.publishModifier(modifier);
		}
		return true;
	}

	private publishModifier(modifier: number): void {
		const key = MODIFIER_KEY_INDICES[modifier];
		const pressed = this.modifierStates[modifier] || this.modifierCounts[modifier] !== 0 || this.keyCounts[key] !== 0;
		if (pressed === this.modifierPressed[modifier]) return;
		this.modifierPressed[modifier] = pressed;
		this.input.setVirtualKeyboardKey(MODIFIER_CODES[modifier], pressed);
		this.recordKeyFeedback(key, pressed);
	}
	private recordKeyFeedback(key: number, down: boolean): void {
		if (down) this.feedbackUntilMs[key] = 0;
		else {
			const expiry = this.feedbackTimeMs + RELEASE_FEEDBACK_MS;
			this.feedbackUntilMs[key] = expiry;
			this.nextFeedbackExpiryMs = Math.min(this.nextFeedbackExpiryMs, expiry);
		}
	}
	private changed(): void {
		this.changeRevision += 1;
		const count = this.listeners.length;
		for (let index = 0; index < count; index += 1) {
			const listener = this.listeners[index];
			if (listener !== null) listener();
		}
	}
}
