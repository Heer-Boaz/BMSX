import { PointerButton, type PointerInputEvent, type WheelInputEvent } from './pointer_event';
import { KeyModifier } from './text';
import type { HostClock } from '../clock';
import type { HostControlInputEvent } from '../control/protocol';
import type { InputEventSink } from './contracts';
import { HOST_SUPERVISOR_KEY_CODE } from './shortcuts';

/** Owns physical press lifetimes; clients never manufacture timestamps or press IDs. */
export class RemoteInput {
	private nextPressId = 1;
	private readonly pressedKeys = new Map<string, number>();
	private readonly pressedButtons = new Map<string, number>();
	private readonly pointer = { x: 0, y: 0, buttons: 0, pressedButtons: 0, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 };
	private readonly wheel = { x: 0, y: 0, deltaX: 0, deltaY: 0, modifiers: KeyModifier.none, timestamp: 0 };

	public constructor(
		private readonly input: InputEventSink,
		private readonly clock: HostClock,
		private readonly editingKey: ((code: string, down: boolean) => void) | undefined = undefined,
		private readonly editingPointer: ((event: PointerInputEvent) => void) | undefined = undefined,
		private readonly editingWheel: ((event: WheelInputEvent) => void) | undefined = undefined,
	) {}

	public apply(events: readonly HostControlInputEvent[]): void {
		const timestamp = this.clock.now();
		for (const event of events) {
			switch (event.type) {
				case 'key':
					this.key(event.code, event.down, timestamp);
					break;
				case 'button': {
					if (this.button('pointer:0', `pointer_${event.button}`, event.down, this.pressedButtons, timestamp)) {
						const mask = POINTER_BUTTON_MASKS[event.button];
						this.pointer.buttons = event.down ? this.pointer.buttons | mask : this.pointer.buttons & ~mask;
						this.publishPointer(timestamp, event.down ? mask : 0, event.down ? 0 : mask, 0);
					}
					break;
				}
				case 'pointer':
					this.input.inputAxis2('pointer:0', 'pointer_position', event.x, event.y, timestamp);
					this.input.inputAxis2('pointer:0', 'pointer_attachment_position', event.x, event.y, timestamp);
					this.pointer.x = event.x; this.pointer.y = event.y;
					this.publishPointer(timestamp, 0, 0, 0);
					break;
				case 'wheel':
					this.input.inputAxis1('pointer:0', 'pointer_wheel', event.deltaY, timestamp);
					this.input.inputAxis1('pointer:0', 'pointer_attachment_wheel', event.deltaY, timestamp);
					if (this.editingWheel !== undefined) {
						const wheel = this.wheel, keys = this.pressedKeys;
						wheel.x = this.pointer.x; wheel.y = this.pointer.y;
						wheel.deltaY = event.deltaY;
						wheel.modifiers = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? KeyModifier.shift : 0)
							| (keys.has('ControlLeft') || keys.has('ControlRight') ? KeyModifier.ctrl : 0)
								| (keys.has('AltLeft') || keys.has('AltRight') ? KeyModifier.alt : 0)
								| (keys.has('MetaLeft') || keys.has('MetaRight') ? KeyModifier.meta : 0);
						wheel.timestamp = timestamp;
						this.editingWheel(wheel);
					}
					break;
				default:
					throw new Error('Unknown host-control input event.');
			}
		}
	}

	private publishPointer(timestamp: number, pressed: number, released: number, cancelled: number): void {
		if (this.editingPointer === undefined) return;
		const pointer = this.pointer, keys = this.pressedKeys;
		pointer.pressedButtons = pressed; pointer.releasedButtons = released; pointer.cancelledButtons = cancelled;
		pointer.modifiers = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? KeyModifier.shift : 0)
			| (keys.has('ControlLeft') || keys.has('ControlRight') ? KeyModifier.ctrl : 0)
			| (keys.has('AltLeft') || keys.has('AltRight') ? KeyModifier.alt : 0)
			| (keys.has('MetaLeft') || keys.has('MetaRight') ? KeyModifier.meta : 0);
		pointer.spaceDown = keys.has('Space'); pointer.timestamp = timestamp;
		this.editingPointer(pointer);
	}

	private key(code: string, down: boolean, timestamp: number): void {
		if (code === HOST_SUPERVISOR_KEY_CODE) this.input.setSupervisorRequestLine(down);
		else if (this.button('keyboard:0', code, down, this.pressedKeys, timestamp)) this.editingKey?.(code, down);
	}

	private button(deviceId: string, code: string, down: boolean, pressed: Map<string, number>, timestamp: number): boolean {
		const previous = pressed.get(code);
		if (down === pressed.has(code)) return false;
		const pressId = down ? this.nextPressId++ : previous;
		if (down) pressed.set(code, pressId);
		else pressed.delete(code);
		this.input.inputButton(deviceId, code, down, down ? 1 : 0, timestamp, pressId);
		return true;
	}

	public release(): void {
		const timestamp = this.clock.now();
		// A disconnected producer cancels ownership; it cannot activate an armed UI key-up.
		for (const code of this.pressedKeys.keys()) this.button('keyboard:0', code, false, this.pressedKeys, timestamp);
		this.input.resetInput('keyboard:0');
		const cancelled = this.pointer.buttons;
		for (const code of this.pressedButtons.keys()) this.button('pointer:0', code, false, this.pressedButtons, timestamp);
		this.pointer.buttons = 0;
		if (cancelled !== 0) this.publishPointer(timestamp, 0, 0, cancelled);
		this.input.setSupervisorRequestLine(false);
	}
}

const POINTER_BUTTON_MASKS = { primary: PointerButton.Primary, secondary: PointerButton.Secondary, aux: PointerButton.Auxiliary, back: 8, forward: 16 } as const;
