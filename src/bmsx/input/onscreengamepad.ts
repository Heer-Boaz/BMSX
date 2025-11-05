import { getPressedState, Input, makeButtonState, resetObject } from './input';
import type { BGamepadButton, VibrationParams } from './inputtypes';
import { ButtonState, InputHandler, KeyOrButtonId2ButtonState } from './inputtypes';

import type {
	OnscreenGamepadControlKind,
	OnscreenGamepadHandleProvider,
	OnscreenGamepadHandles,
	OnscreenGamepadPlatform,
	OnscreenGamepadPlatformHooks,
	OnscreenGamepadPlatformSession,
	OnscreenPointerEvent,
} from '../platform';
import { $ } from '../core/game';

export type {
	OnscreenGamepadControlKind,
	OnscreenGamepadPlatform,
	OnscreenGamepadPlatformHooks,
	OnscreenGamepadPlatformSession,
	OnscreenPointerEvent,
} from '../platform';

export class NullOnscreenGamepadPlatform implements OnscreenGamepadPlatform {
	attach(): OnscreenGamepadPlatformSession {
		throw new Error('[OnscreenGamepad] No platform has been installed.');
	}

	hideElements(): void {
		throw new Error('[OnscreenGamepad] No platform has been installed.');
	}

	collectElementIds(): string[] {
		throw new Error('[OnscreenGamepad] No platform has been installed.');
	}

	setElementActive(): void {
		throw new Error('[OnscreenGamepad] No platform has been installed.');
	}

	resetElements(): void {
		throw new Error('[OnscreenGamepad] No platform has been installed.');
	}

	updateDpadRing(): void {
		throw new Error('[OnscreenGamepad] No platform has been installed.');
	}

	supportsVibration(): boolean {
		return false;
	}

	vibrate(): void {
		throw new Error('[OnscreenGamepad] No platform has been installed.');
	}
}

interface HitTestResult {
	elements: string[];
	buttons: string[];
}

export class OnscreenGamepad implements InputHandler {
	public static readonly VIRTUAL_PAD_INDEX = 0x7ffffffe;
	public readonly gamepadIndex = OnscreenGamepad.VIRTUAL_PAD_INDEX;

	private readonly platform: OnscreenGamepadPlatform;
	private session: OnscreenGamepadPlatformSession | null = null;
	private activeCounts: Record<string, number> = {};
	private pointer2Buttons = new Map<number, Set<string>>();
	private pointer2Elements = new Map<number, Set<string>>();
	private elementActiveCount = new Map<string, number>();
	private gamepadButtonStates: KeyOrButtonId2ButtonState = {};
	private nextPressId = 1;
	private handlesProvider: OnscreenGamepadHandleProvider | null = null;

	constructor(platform: OnscreenGamepadPlatform) {
		this.platform = platform;
	}

	public get supportsVibrationEffect(): boolean {
		return this.platform.supportsVibration();
	}

	public applyVibrationEffect(params: VibrationParams): void {
		if (!this.platform.supportsVibration()) {
			return;
		}
		let intensity = 1;
		if (typeof params.intensity === 'number') {
			intensity = params.intensity;
		}
		if (intensity < 0) {
			intensity = 0;
		}
		if (intensity > 1) {
			intensity = 1;
		}
		let duration = 0;
		if (typeof params.duration === 'number') {
			duration = params.duration;
		}
		if (duration < 0) {
			duration = 0;
		}
		const scaled = Math.round(duration * intensity);
		if (scaled <= 0) {
			return;
		}
		this.platform.vibrate(scaled);
	}

	public static hideButtons(gamepad_button_ids: string[]): void {
		const platform = $.platform.onscreenGamepad; // TODO: UGLY!!
		const elementIds: string[] = [];
		for (let i = 0; i < gamepad_button_ids.length; i++) {
			const button = gamepad_button_ids[i];
			const elementId = OnscreenGamepad.ACTION_BUTTON_TO_ELEMENTID_MAP[button];
			if (!elementId) {
				throw new Error(`Error while attempting to hide on-screen button '${button}' - no element mapping was found.`);
			}
			elementIds.push(elementId);
		}
		platform.hideElements(elementIds);
	}

	public getButtonState(btn: string): ButtonState {
		return getPressedState(this.gamepadButtonStates, btn);
	}

	public pollInput(): void {
		const defaultState = makeButtonState();
		const now = $.platform.clock.now();
		const newStates: KeyOrButtonId2ButtonState = {};
		for (let i = 0; i < Input.BUTTON_IDS.length; i++) {
			const button = Input.BUTTON_IDS[i];
			const existing = this.gamepadButtonStates[button];
			const previous = existing ? existing : makeButtonState(defaultState);
			const countValue = this.activeCounts[button];
			const count = typeof countValue === 'number' ? countValue : 0;
			const isDown = count > 0;
			if (isDown) {
				const wasPressed = previous.pressed === true;
				const previousPressId = typeof previous.pressId === 'number' ? previous.pressId : null;
				const pressedAt = wasPressed
					? (typeof previous.pressedAtMs === 'number' ? previous.pressedAtMs : previous.timestamp ?? now)
					: now;
				const newPressId = wasPressed ? previousPressId ?? this.nextPressId++ : this.nextPressId++;
				newStates[button] = {
					...previous,
					pressed: true,
					justpressed: !wasPressed,
					justreleased: false,
					presstime: Math.max(0, now - pressedAt),
					consumed: false,
					timestamp: wasPressed ? (previous.timestamp ?? pressedAt) : now,
					pressedAtMs: pressedAt,
					releasedAtMs: null,
					pressId: newPressId,
					value: 1,
				};
			} else {
				const was = previous.pressed === true;
				newStates[button] = {
					...previous,
					pressed: false,
					justpressed: false,
					justreleased: was,
					presstime: null,
					consumed: false,
					timestamp: now,
					pressId: typeof previous.pressId === 'number' ? previous.pressId : null,
					pressedAtMs: null,
					releasedAtMs: was ? now : previous.releasedAtMs ?? null,
					value: 0,
				};
			}
		}
		this.gamepadButtonStates = newStates;
	}

	public consumeButton(button: string): void {
		if (!this.gamepadButtonStates[button]) {
			this.gamepadButtonStates[button] = makeButtonState();
		}
		this.gamepadButtonStates[button].consumed = true;
	}

	private static readonly DPAD_BUTTON_MAP: Record<string, { buttons: string[] }> = {
		'd-pad-u': { buttons: ['up' satisfies BGamepadButton] },
		'd-pad-ru': { buttons: ['up' satisfies BGamepadButton, 'right' satisfies BGamepadButton] },
		'd-pad-r': { buttons: ['right' satisfies BGamepadButton] },
		'd-pad-rd': { buttons: ['right' satisfies BGamepadButton, 'down' satisfies BGamepadButton] },
		'd-pad-d': { buttons: ['down' satisfies BGamepadButton] },
		'd-pad-ld': { buttons: ['down' satisfies BGamepadButton, 'left' satisfies BGamepadButton] },
		'd-pad-l': { buttons: ['left' satisfies BGamepadButton] },
		'd-pad-lu': { buttons: ['left' satisfies BGamepadButton, 'up' satisfies BGamepadButton] },
	};

	private static readonly ACTION_BUTTON_MAP: Record<string, { buttons: string[] }> = {
		'a_knop': { buttons: ['a' satisfies BGamepadButton] },
		'b_knop': { buttons: ['b' satisfies BGamepadButton] },
		'x_knop': { buttons: ['x' satisfies BGamepadButton] },
		'y_knop': { buttons: ['y' satisfies BGamepadButton] },
		'ls_knop': { buttons: ['ls' satisfies BGamepadButton] },
		'rs_knop': { buttons: ['rs' satisfies BGamepadButton] },
		'select_knop': { buttons: ['select' satisfies BGamepadButton] },
		'start_knop': { buttons: ['start' satisfies BGamepadButton] },
	};

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
	};

	private static readonly DPAD_NEIGHBORS: Record<string, string[]> = {
		'd-pad-lu': ['d-pad-u', 'd-pad-l'],
		'd-pad-u': ['d-pad-lu', 'd-pad-ru'],
		'd-pad-ru': ['d-pad-u', 'd-pad-r'],
		'd-pad-r': ['d-pad-ru', 'd-pad-rd'],
		'd-pad-ld': ['d-pad-d', 'd-pad-l'],
		'd-pad-d': ['d-pad-ld', 'd-pad-rd'],
		'd-pad-rd': ['d-pad-d', 'd-pad-r'],
		'd-pad-l': ['d-pad-lu', 'd-pad-ld'],
	};

	private static readonly ALL_BUTTON_MAP: Record<string, { buttons: string[] }> = {
		...OnscreenGamepad.DPAD_BUTTON_MAP,
		...OnscreenGamepad.ACTION_BUTTON_MAP,
	};

	private static readonly DPAD_BUTTON_ELEMENT_IDS = Object.keys(OnscreenGamepad.DPAD_BUTTON_MAP);
	private static readonly ONSCREEN_BUTTON_ELEMENT_NAMES = Object.keys(OnscreenGamepad.ALL_BUTTON_MAP);

	public init(): void {
		this.reset();
		if (this.session !== null) {
			this.session.dispose();
			this.session = null;
		}
		const hooks: OnscreenGamepadPlatformHooks = {
			pointerDown: (kind, event) => this.onPointerDown(kind, event),
			pointerMove: (kind, event) => this.onPointerMove(kind, event),
			pointerUp: (kind, event) => this.onPointerUp(kind, event),
			blur: () => this.reset(),
			focus: () => this.reset(),
			pointerOut: () => this.reset(),
		};
		this.session = this.platform.attach(hooks);
	}

	private onPointerDown(kind: OnscreenGamepadControlKind, event: OnscreenPointerEvent): void {
		const hit = this.hitTest(kind, event.clientX, event.clientY);
		this.updateForPointer(event.pointerId, hit.elements, hit.buttons, event);
	}

	private onPointerMove(kind: OnscreenGamepadControlKind, event: OnscreenPointerEvent): void {
		if (event.buttons === 0 && event.pressure === 0) {
			return;
		}
		const hit = this.hitTest(kind, event.clientX, event.clientY);
		this.updateForPointer(event.pointerId, hit.elements, hit.buttons, event);
	}

	private onPointerUp(_kind: OnscreenGamepadControlKind, event: OnscreenPointerEvent): void {
		const prevButtons = this.pointer2Buttons.get(event.pointerId);
		if (prevButtons) {
			const iterator = prevButtons.values();
			for (let current = iterator.next(); !current.done; current = iterator.next()) {
				const button = current.value;
				const countValue = this.activeCounts[button];
				const nextCount = typeof countValue === 'number' ? countValue - 1 : -1;
				this.activeCounts[button] = nextCount > 0 ? nextCount : 0;
			}
		}
		const prevElements = this.pointer2Elements.get(event.pointerId);
		if (prevElements) {
			const iterator = prevElements.values();
			for (let current = iterator.next(); !current.done; current = iterator.next()) {
				const id = current.value;
				const countValue = this.elementActiveCount.get(id);
				const nextCount = typeof countValue === 'number' ? countValue - 1 : -1;
				const clamped = nextCount > 0 ? nextCount : 0;
				this.elementActiveCount.set(id, clamped);
				if (clamped === 0) {
					this.platform.setElementActive(id, false);
				}
			}
		}
		this.updateDpadRing();
		this.pointer2Buttons.delete(event.pointerId);
		this.pointer2Elements.delete(event.pointerId);
		event.release();
	}

	private hitTest(kind: OnscreenGamepadControlKind, clientX: number, clientY: number): HitTestResult {
		const rawIds = this.platform.collectElementIds(clientX, clientY, kind);
		if (rawIds.length === 0) {
			return { elements: [], buttons: [] };
		}
		const normalized = new Set<string>();
		for (let i = 0; i < rawIds.length; i++) {
			const base = this.baseId(rawIds[i]);
			if (base.length === 0) {
				continue;
			}
			normalized.add(base);
		}
		if (kind === 'action') {
			const iterator = normalized.values();
			for (let current = iterator.next(); !current.done; current = iterator.next()) {
				const id = current.value;
				const entry = OnscreenGamepad.ACTION_BUTTON_MAP[id];
				if (entry) {
					return { elements: [id], buttons: entry.buttons };
				}
			}
			return { elements: [], buttons: [] };
		}
		const iterator = normalized.values();
		for (let current = iterator.next(); !current.done; current = iterator.next()) {
			const id = current.value;
			const entry = OnscreenGamepad.DPAD_BUTTON_MAP[id];
			if (!entry) {
				continue;
			}
			const neighborCandidates = OnscreenGamepad.DPAD_NEIGHBORS[id];
			const elements: string[] = [id];
			if (neighborCandidates) {
				for (let i = 0; i < neighborCandidates.length; i++) {
					elements.push(neighborCandidates[i]);
				}
			}
			return { elements, buttons: entry.buttons };
		}
		return { elements: [], buttons: [] };
	}

	private updateForPointer(pointerId: number, newElements: string[], newButtons: string[], event: OnscreenPointerEvent): void {
		const previousButtons = this.pointer2Buttons.get(pointerId) || new Set<string>();
		const previousElements = this.pointer2Elements.get(pointerId) || new Set<string>();
		const newButtonSet = new Set<string>();
		for (let i = 0; i < newButtons.length; i++) {
			newButtonSet.add(newButtons[i]);
		}
		const newElementSet = new Set<string>();
		for (let i = 0; i < newElements.length; i++) {
			newElementSet.add(newElements[i]);
		}

		const prevButtonIterator = previousButtons.values();
		for (let current = prevButtonIterator.next(); !current.done; current = prevButtonIterator.next()) {
			const button = current.value;
			if (newButtonSet.has(button)) {
				continue;
			}
			const countValue = this.activeCounts[button];
			const nextCount = typeof countValue === 'number' ? countValue - 1 : -1;
			this.activeCounts[button] = nextCount > 0 ? nextCount : 0;
		}
		const newButtonIterator = newButtonSet.values();
		for (let current = newButtonIterator.next(); !current.done; current = newButtonIterator.next()) {
			const button = current.value;
			if (previousButtons.has(button)) {
				continue;
			}
			const countValue = this.activeCounts[button];
			const nextCount = typeof countValue === 'number' ? countValue + 1 : 1;
			this.activeCounts[button] = nextCount;
		}

		const prevElementIterator = previousElements.values();
		for (let current = prevElementIterator.next(); !current.done; current = prevElementIterator.next()) {
			const id = current.value;
			if (newElementSet.has(id)) {
				continue;
			}
			const countValue = this.elementActiveCount.get(id);
			const nextCount = typeof countValue === 'number' ? countValue - 1 : -1;
			const clamped = nextCount > 0 ? nextCount : 0;
			this.elementActiveCount.set(id, clamped);
			if (clamped === 0) {
				this.platform.setElementActive(id, false);
			}
		}
		const newElementIterator = newElementSet.values();
		for (let current = newElementIterator.next(); !current.done; current = newElementIterator.next()) {
			const id = current.value;
			if (previousElements.has(id)) {
				continue;
			}
			const countValue = this.elementActiveCount.get(id);
			const nextCount = typeof countValue === 'number' ? countValue + 1 : 1;
			this.elementActiveCount.set(id, nextCount);
			if (nextCount === 1) {
				this.platform.setElementActive(id, true);
			}
		}

		this.updateDpadRing();
		this.pointer2Buttons.set(pointerId, newButtonSet);
		this.pointer2Elements.set(pointerId, newElementSet);
		event.capture();
	}

	private baseId(id: string): string {
		if (id.length === 0) {
			return '';
		}
		if (id.endsWith('_text')) {
			return id.slice(0, id.length - 5);
		}
		return id;
	}

	private updateDpadRing(): void {
		const active: string[] = [];
		for (let i = 0; i < OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS.length; i++) {
			const id = OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS[i];
			const countValue = this.elementActiveCount.get(id);
			if (typeof countValue === 'number' && countValue > 0) {
				active.push(id);
			}
		}
		this.platform.updateDpadRing(active);
	}

	public reset(except?: string[]): void {
		if (!except) {
			for (let i = 0; i < Input.BUTTON_IDS.length; i++) {
				const buttonId = Input.BUTTON_IDS[i];
				this.gamepadButtonStates[buttonId] = makeButtonState();
			}
			this.activeCounts = {};
			this.pointer2Buttons.clear();
			this.pointer2Elements.clear();
			this.elementActiveCount.clear();
			this.resetUI();
		} else {
			resetObject(this.gamepadButtonStates, except);
		}
	}

	public resetUI(elementsToFilterById?: string[]): void {
		if (elementsToFilterById && elementsToFilterById.length > 0) {
			const excluded = new Set(elementsToFilterById);
			const targets: string[] = [];
			for (let i = 0; i < OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.length; i++) {
				const elementId = OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES[i];
				if (excluded.has(elementId)) {
					continue;
				}
				targets.push(elementId);
			}
			this.platform.resetElements(targets);
			return;
		}
		this.platform.resetElements(OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES);
	}

	public blur(_e: FocusEvent): void {
		this.reset();
	}

	public focus(_e: FocusEvent): void {
		this.reset();
	}

	public dispose(): void {
		if (this.session !== null) {
			this.session.dispose();
			this.session = null;
		}
		this.reset();
		this.handlesProvider = null;
	}

	public getLayoutMargins(viewportWidth: number, viewportHeight: number): OnscreenGamepadLayout {
		const handles = this.resolveHandles();
		if (!handles) {
			return OnscreenGamepad.EMPTY_LAYOUT;
		}
		const dpadRect = handles.dpad.measure();
		const actionRect = handles.actionButtons.measure();
		const hasDpad = dpadRect.width > 0 && dpadRect.height > 0;
		const hasAction = actionRect.width > 0 && actionRect.height > 0;
		if (!hasDpad && !hasAction) {
			return OnscreenGamepad.EMPTY_LAYOUT;
		}

		const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
		const maxSvgScale = referenceDimension * 0.20 / 100;

		let left = 0;
		if (hasDpad) {
			const dpadWidthAttr = handles.dpad.getNumericAttribute('width');
			left = dpadWidthAttr !== null ? dpadWidthAttr * maxSvgScale : dpadRect.width;
		}

		let right = 0;
		if (hasAction) {
			const actionWidthAttr = handles.actionButtons.getNumericAttribute('width');
			right = actionWidthAttr !== null ? actionWidthAttr * maxSvgScale : actionRect.width;
		}

		const dpadHeightAttr = handles.dpad.getNumericAttribute('height');
		const actionHeightAttr = handles.actionButtons.getNumericAttribute('height');
		let bottom = 0;
		const estimatedHeight = Math.max(
			dpadHeightAttr !== null ? dpadHeightAttr * maxSvgScale : dpadRect.height,
			actionHeightAttr !== null ? actionHeightAttr * maxSvgScale : actionRect.height,
		);
		if (estimatedHeight > 0) {
			bottom = estimatedHeight + 16;
		}

		return {
			left,
			right,
			bottom,
			visible: true,
		};
	}

	private resolveHandles(): OnscreenGamepadHandles | null {
		if (!this.handlesProvider) {
			const host = $.platform.gameviewHost;
			if (!host) {
				return null;
			}
			const provider = host.getCapability('onscreen-gamepad');
			this.handlesProvider = provider ?? null;
		}
		return this.handlesProvider?.getHandles() ?? null;
	}

	private static readonly EMPTY_LAYOUT: OnscreenGamepadLayout = Object.freeze({
		left: 0,
		right: 0,
		bottom: 0,
		visible: false,
	});
}

export interface OnscreenGamepadLayout {
	left: number;
	right: number;
	bottom: number;
	visible: boolean;
}
