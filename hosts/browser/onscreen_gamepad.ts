import type { GamepadDevice, InputEventSink } from '../common/input/contracts';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';
import type { BGamepadButton } from '../common/input/models';

const enum OnscreenElement {
	DpadUp,
	DpadUpRight,
	DpadRight,
	DpadDownRight,
	DpadDown,
	DpadDownLeft,
	DpadLeft,
	DpadUpLeft,
	ActionA,
	ActionB,
	ActionX,
	ActionY,
	ActionLeftStick,
	ActionRightStick,
	ActionSelect,
	ActionStart,
}

interface OnscreenHit {
	readonly elementMask: number;
	readonly buttonMask: number;
}

function gamepadButtonMask(button: BGamepadButton): number {
	return 1 << GAMEPAD_BUTTON_IDS.indexOf(button);
}

const EMPTY_HIT: OnscreenHit = { elementMask: 0, buttonMask: 0 };
const DPAD_UP_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadUp)
		| (1 << OnscreenElement.DpadUpLeft)
		| (1 << OnscreenElement.DpadUpRight),
	buttonMask: gamepadButtonMask('up'),
};
const DPAD_UP_RIGHT_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadUpRight)
		| (1 << OnscreenElement.DpadUp)
		| (1 << OnscreenElement.DpadRight),
	buttonMask: gamepadButtonMask('up') | gamepadButtonMask('right'),
};
const DPAD_RIGHT_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadRight)
		| (1 << OnscreenElement.DpadUpRight)
		| (1 << OnscreenElement.DpadDownRight),
	buttonMask: gamepadButtonMask('right'),
};
const DPAD_DOWN_RIGHT_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadDownRight)
		| (1 << OnscreenElement.DpadDown)
		| (1 << OnscreenElement.DpadRight),
	buttonMask: gamepadButtonMask('right') | gamepadButtonMask('down'),
};
const DPAD_DOWN_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadDown)
		| (1 << OnscreenElement.DpadDownLeft)
		| (1 << OnscreenElement.DpadDownRight),
	buttonMask: gamepadButtonMask('down'),
};
const DPAD_DOWN_LEFT_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadDownLeft)
		| (1 << OnscreenElement.DpadDown)
		| (1 << OnscreenElement.DpadLeft),
	buttonMask: gamepadButtonMask('down') | gamepadButtonMask('left'),
};
const DPAD_LEFT_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadLeft)
		| (1 << OnscreenElement.DpadUpLeft)
		| (1 << OnscreenElement.DpadDownLeft),
	buttonMask: gamepadButtonMask('left'),
};
const DPAD_UP_LEFT_HIT: OnscreenHit = {
	elementMask:
		(1 << OnscreenElement.DpadUpLeft)
		| (1 << OnscreenElement.DpadUp)
		| (1 << OnscreenElement.DpadLeft),
	buttonMask: gamepadButtonMask('left') | gamepadButtonMask('up'),
};
const ACTION_A_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionA,
	buttonMask: gamepadButtonMask('a'),
};
const ACTION_B_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionB,
	buttonMask: gamepadButtonMask('b'),
};
const ACTION_X_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionX,
	buttonMask: gamepadButtonMask('x'),
};
const ACTION_Y_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionY,
	buttonMask: gamepadButtonMask('y'),
};
const ACTION_LEFT_STICK_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionLeftStick,
	buttonMask: gamepadButtonMask('ls'),
};
const ACTION_RIGHT_STICK_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionRightStick,
	buttonMask: gamepadButtonMask('rs'),
};
const ACTION_SELECT_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionSelect,
	buttonMask: gamepadButtonMask('select'),
};
const ACTION_START_HIT: OnscreenHit = {
	elementMask: 1 << OnscreenElement.ActionStart,
	buttonMask: gamepadButtonMask('start'),
};

const ONSCREEN_ELEMENT_IDS = [
	'd-pad-u',
	'd-pad-ru',
	'd-pad-r',
	'd-pad-rd',
	'd-pad-d',
	'd-pad-ld',
	'd-pad-l',
	'd-pad-lu',
	'a_knop',
	'b_knop',
	'x_knop',
	'y_knop',
	'ls_knop',
	'rs_knop',
	'select_knop',
	'start_knop',
] as const;
const DPAD_ELEMENT_COUNT = OnscreenElement.DpadUpLeft + 1;

function dpadHit(elementId: string): OnscreenHit {
	switch (elementId) {
		case 'd-pad-u': return DPAD_UP_HIT;
		case 'd-pad-ru': return DPAD_UP_RIGHT_HIT;
		case 'd-pad-r': return DPAD_RIGHT_HIT;
		case 'd-pad-rd': return DPAD_DOWN_RIGHT_HIT;
		case 'd-pad-d': return DPAD_DOWN_HIT;
		case 'd-pad-ld': return DPAD_DOWN_LEFT_HIT;
		case 'd-pad-l': return DPAD_LEFT_HIT;
		case 'd-pad-lu': return DPAD_UP_LEFT_HIT;
		default: return EMPTY_HIT;
	}
}

function actionHit(elementId: string): OnscreenHit {
	switch (elementId) {
		case 'a_knop':
		case 'a_knop_text':
			return ACTION_A_HIT;
		case 'b_knop':
		case 'b_knop_text':
			return ACTION_B_HIT;
		case 'x_knop':
		case 'x_knop_text':
			return ACTION_X_HIT;
		case 'y_knop':
		case 'y_knop_text':
			return ACTION_Y_HIT;
		case 'ls_knop':
		case 'ls_knop_text':
			return ACTION_LEFT_STICK_HIT;
		case 'rs_knop':
		case 'rs_knop_text':
			return ACTION_RIGHT_STICK_HIT;
		case 'select_knop':
		case 'select_knop_text':
			return ACTION_SELECT_HIT;
		case 'start_knop':
		case 'start_knop_text':
			return ACTION_START_HIT;
		default:
			return EMPTY_HIT;
	}
}

function removeDpadClasses(target: Element): void {
	for (let index = target.classList.length - 1; index >= 0; index -= 1) {
		const className = target.classList.item(index);
		if (className && className.indexOf('d-pad-') === 0) {
			target.classList.remove(className);
		}
	}
}

/**
 * Browser-owned virtual gamepad. DOM pointer state is retained here and
 * published through the same GamepadDevice boundary as physical controllers.
 */
export class BrowserOnscreenGamepad implements GamepadDevice {
	public static readonly GAMEPAD_INDEX = 0x7ffffffe;
	public readonly id = `gamepad:${BrowserOnscreenGamepad.GAMEPAD_INDEX}`;
	public readonly kind = 'gamepad';
	public readonly gamepadIndex = BrowserOnscreenGamepad.GAMEPAD_INDEX;
	public readonly vibrationInitialization = null;
	public readonly supportsVibration = navigator.vibrate != null;
	public readonly dpadElement: HTMLElement;
	public readonly actionButtonsElement: HTMLElement;

	private readonly document: Document;
	private readonly window: Window;
	private readonly elements: Element[] = [];
	private readonly textElements: Array<Element | null> = [];
	private readonly dpadRing: Element;
	private readonly buttonCounts = new Uint8Array(GAMEPAD_BUTTON_IDS.length);
	private readonly elementCounts = new Uint8Array(ONSCREEN_ELEMENT_IDS.length);
	private readonly pointerIds: number[] = [];
	private readonly pointerButtonMasks: number[] = [];
	private readonly pointerElementMasks: number[] = [];
	private readonly pressIds = new Float64Array(GAMEPAD_BUTTON_IDS.length);
	private activeButtons = 0;
	private activeElements = 0;
	private publishedButtons = 0;
	private nextPressId = 1;

	public constructor(document: Document, window: Window) {
		this.document = document;
		this.window = window;
		this.dpadElement = this.requireHtmlElement('d-pad-controls');
		this.actionButtonsElement = this.requireHtmlElement('button-controls');
		this.dpadRing = this.requireElement('d-pad-omheining');
		this.dpadRing.setAttribute('pointer-events', 'none');
		const dpadImages = this.dpadElement.querySelectorAll<SVGImageElement>('.d-pad-image');
		for (let index = 0; index < dpadImages.length; index += 1) {
			dpadImages[index].style.pointerEvents = 'none';
		}
		for (let index = 0; index < ONSCREEN_ELEMENT_IDS.length; index += 1) {
			const id = ONSCREEN_ELEMENT_IDS[index];
			this.elements[index] = this.requireElement(id);
			this.textElements[index] = index < DPAD_ELEMENT_COUNT
				? null
				: this.requireElement(`${id}_text`);
		}
		this.configureSurface(this.dpadElement);
		this.configureSurface(this.actionButtonsElement);
		this.bindPointerSurface(this.dpadElement, this.onDpadPointerDown, this.onDpadPointerMove);
		this.bindPointerSurface(this.actionButtonsElement, this.onActionPointerDown, this.onActionPointerMove);
		this.window.addEventListener('blur', this.reset);
		this.window.addEventListener('focus', this.reset);
		this.window.addEventListener('mouseout', this.reset);
		this.reset();
	}

	public setVibration(durationMs: number, intensity: number): void {
		navigator.vibrate(durationMs * intensity);
	}

	public poll(time: number, sink: InputEventSink): void {
		const changedButtons = (this.activeButtons ^ this.publishedButtons) >>> 0;
		for (let index = 0; index < GAMEPAD_BUTTON_IDS.length; index += 1) {
			const mask = 1 << index;
			if ((changedButtons & mask) === 0) {
				continue;
			}
			const down = (this.activeButtons & mask) !== 0;
			if (down) {
				this.pressIds[index] = this.nextPressId++;
			}
			sink.inputButton(
				this.id,
				GAMEPAD_BUTTON_IDS[index],
				down,
				down ? 1 : 0,
				time,
				this.pressIds[index],
			);
		}
		this.publishedButtons = this.activeButtons;
	}

	private readonly onDpadPointerDown = (event: PointerEvent): void => {
		this.pointerDown(event, true);
	};

	private readonly onActionPointerDown = (event: PointerEvent): void => {
		this.pointerDown(event, false);
	};

	private readonly onDpadPointerMove = (event: PointerEvent): void => {
		this.pointerMove(event, true);
	};

	private readonly onActionPointerMove = (event: PointerEvent): void => {
		this.pointerMove(event, false);
	};

	private pointerDown(event: PointerEvent, dpad: boolean): void {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		this.updatePointer(event.pointerId, this.hitTest(event.clientX, event.clientY, dpad));
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
	}

	private pointerMove(event: PointerEvent, dpad: boolean): void {
		if (event.buttons === 0 && event.pressure === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		this.updatePointer(event.pointerId, this.hitTest(event.clientX, event.clientY, dpad));
	}

	private readonly pointerUp = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const pointerIndex = this.pointerIndex(event.pointerId);
		if (pointerIndex >= 0) {
			this.updateButtonCounts(this.pointerButtonMasks[pointerIndex], 0);
			this.updateElementCounts(this.pointerElementMasks[pointerIndex], 0);
			const last = this.pointerIds.length - 1;
			this.pointerIds[pointerIndex] = this.pointerIds[last];
			this.pointerButtonMasks[pointerIndex] = this.pointerButtonMasks[last];
			this.pointerElementMasks[pointerIndex] = this.pointerElementMasks[last];
			this.pointerIds.length = last;
			this.pointerButtonMasks.length = last;
			this.pointerElementMasks.length = last;
		}
		this.updateDpadRing();
		const surface = event.currentTarget as Element;
		if (surface.hasPointerCapture(event.pointerId)) {
			surface.releasePointerCapture(event.pointerId);
		}
	};

	private hitTest(clientX: number, clientY: number, dpad: boolean): OnscreenHit {
		const element = this.document.elementFromPoint(clientX, clientY);
		return element
			? (dpad ? dpadHit(element.id) : actionHit(element.id))
			: EMPTY_HIT;
	}

	private updatePointer(pointerId: number, hit: OnscreenHit): void {
		const pointerIndex = this.pointerIndex(pointerId);
		const previousButtonMask = pointerIndex >= 0 ? this.pointerButtonMasks[pointerIndex] : 0;
		const previousElementMask = pointerIndex >= 0 ? this.pointerElementMasks[pointerIndex] : 0;
		if (previousButtonMask === hit.buttonMask && previousElementMask === hit.elementMask) {
			return;
		}
		this.updateButtonCounts(previousButtonMask, hit.buttonMask);
		this.updateElementCounts(previousElementMask, hit.elementMask);
		if (pointerIndex >= 0) {
			this.pointerButtonMasks[pointerIndex] = hit.buttonMask;
			this.pointerElementMasks[pointerIndex] = hit.elementMask;
		} else {
			this.pointerIds.push(pointerId);
			this.pointerButtonMasks.push(hit.buttonMask);
			this.pointerElementMasks.push(hit.elementMask);
		}
		this.updateDpadRing();
	}

	private updateButtonCounts(previousMask: number, nextMask: number): void {
		const released = (previousMask & ~nextMask) >>> 0;
		const pressed = (nextMask & ~previousMask) >>> 0;
		for (let index = 0; index < GAMEPAD_BUTTON_IDS.length; index += 1) {
			const mask = 1 << index;
			if ((released & mask) !== 0) {
				const count = this.buttonCounts[index] - 1;
				this.buttonCounts[index] = count;
				if (count === 0) {
					this.activeButtons = (this.activeButtons & ~mask) >>> 0;
				}
			}
			if ((pressed & mask) !== 0) {
				const count = this.buttonCounts[index] + 1;
				this.buttonCounts[index] = count;
				if (count === 1) {
					this.activeButtons = (this.activeButtons | mask) >>> 0;
				}
			}
		}
	}

	private updateElementCounts(previousMask: number, nextMask: number): void {
		const released = previousMask & ~nextMask;
		const pressed = nextMask & ~previousMask;
		for (let index = 0; index < ONSCREEN_ELEMENT_IDS.length; index += 1) {
			const mask = 1 << index;
			if ((released & mask) !== 0) {
				const count = this.elementCounts[index] - 1;
				this.elementCounts[index] = count;
				if (count === 0) {
					this.activeElements &= ~mask;
					this.setElementActive(index, false);
				}
			}
			if ((pressed & mask) !== 0) {
				const count = this.elementCounts[index] + 1;
				this.elementCounts[index] = count;
				if (count === 1) {
					this.activeElements |= mask;
					this.setElementActive(index, true);
				}
			}
		}
	}

	private setElementActive(index: number, active: boolean): void {
		const element = this.elements[index];
		const textElement = this.textElements[index];
		if (active) {
			element.classList.add('druk');
			element.classList.remove('los');
			element.setAttribute('data-touched', 'true');
			if (textElement) {
				textElement.classList.add('druk');
				textElement.classList.remove('los');
				textElement.setAttribute('data-touched', 'true');
			}
			return;
		}
		element.classList.remove('druk');
		element.classList.add('los');
		element.setAttribute('data-touched', 'false');
		if (textElement) {
			textElement.classList.remove('druk');
			textElement.classList.add('los');
			textElement.setAttribute('data-touched', 'false');
		}
	}

	private updateDpadRing(): void {
		removeDpadClasses(this.dpadRing);
		for (let index = 0; index < DPAD_ELEMENT_COUNT; index += 1) {
			if ((this.activeElements & (1 << index)) !== 0) {
				this.dpadRing.classList.add(ONSCREEN_ELEMENT_IDS[index]);
			}
		}
	}

	private readonly reset = (): void => {
		this.buttonCounts.fill(0);
		this.elementCounts.fill(0);
		this.pointerIds.length = 0;
		this.pointerButtonMasks.length = 0;
		this.pointerElementMasks.length = 0;
		this.activeButtons = 0;
		this.activeElements = 0;
		for (let index = 0; index < ONSCREEN_ELEMENT_IDS.length; index += 1) {
			this.setElementActive(index, false);
		}
		this.updateDpadRing();
	};

	private pointerIndex(pointerId: number): number {
		for (let index = 0; index < this.pointerIds.length; index += 1) {
			if (this.pointerIds[index] === pointerId) {
				return index;
			}
		}
		return -1;
	}

	private bindPointerSurface(
		surface: HTMLElement,
		pointerDown: (event: PointerEvent) => void,
		pointerMove: (event: PointerEvent) => void,
	): void {
		surface.addEventListener('pointerdown', pointerDown, { passive: false });
		surface.addEventListener('pointermove', pointerMove, { passive: false });
		surface.addEventListener('pointerup', this.pointerUp, { passive: false });
		surface.addEventListener('pointercancel', this.pointerUp, { passive: false });
		surface.addEventListener('lostpointercapture', this.pointerUp, { passive: false });
	}

	private configureSurface(surface: HTMLElement): void {
		surface.style.touchAction = 'none';
		surface.style.pointerEvents = 'auto';
		surface.style.userSelect = 'none';
		surface.style.setProperty('-webkit-touch-callout', 'none');
		surface.style.setProperty('-webkit-tap-highlight-color', 'transparent');
		surface.style.setProperty('-ms-touch-action', 'none');
		surface.hidden = false;
		surface.setAttribute('aria-hidden', 'false');
		surface.classList.remove('hidden');
		surface.removeAttribute('hidden');
	}

	private requireHtmlElement(id: string): HTMLElement {
		const element = this.document.getElementById(id);
		if (!(element instanceof HTMLElement)) {
			throw new Error(`[BrowserOnscreenGamepad] Element '#${id}' is not an HTMLElement.`);
		}
		return element;
	}

	private requireElement(id: string): Element {
		const element = this.document.getElementById(id);
		if (!element) {
			throw new Error(`[BrowserOnscreenGamepad] Element '#${id}' was not found.`);
		}
		return element;
	}
}
