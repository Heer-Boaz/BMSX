import type { HostClock } from '../clock';
import type { HostControlInputEvent } from '../control/protocol';
import type { InputEventWriter } from './contracts';
import { HOST_SUPERVISOR_KEY_CODE } from './shortcuts';

/** Owns physical press lifetimes; clients never manufacture timestamps or press IDs. */
export class RemoteInput {
	private nextPressId = 1;
	private readonly pressedKeys = new Map<string, number>();
	private readonly pressedButtons = new Map<string, number>();

	public constructor(private readonly input: InputEventWriter, private readonly clock: HostClock) {}

	public apply(events: readonly HostControlInputEvent[]): void {
		const timestamp = this.clock.now();
		for (const event of events) {
			switch (event.type) {
				case 'key':
					if (event.code === HOST_SUPERVISOR_KEY_CODE) {
						this.input.post({ type: 'supervisor-request', down: event.down, timestamp });
					} else {
						this.button('keyboard:0', event.code, event.down, this.pressedKeys, timestamp);
					}
					break;
				case 'button':
					this.button('pointer:0', `pointer_${event.button}`, event.down, this.pressedButtons, timestamp);
					break;
				case 'pointer':
					this.input.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.x, y: event.y, timestamp });
					break;
				case 'wheel':
					this.input.post({ type: 'axis1', deviceId: 'pointer:0', code: 'pointer_wheel', x: event.deltaY, timestamp });
					break;
				default:
					throw new Error('Unknown host-control input event.');
			}
		}
	}

	private button(deviceId: string, code: string, down: boolean, pressed: Map<string, number>, timestamp: number): void {
		const previous = pressed.get(code);
		if (down === pressed.has(code)) return;
		const pressId = down ? this.nextPressId++ : previous;
		if (down) pressed.set(code, pressId);
		else pressed.delete(code);
		this.input.post({ type: 'button', deviceId, code, down, value: down ? 1 : 0, timestamp, pressId });
	}

	public release(): void {
		const timestamp = this.clock.now();
		for (const code of this.pressedKeys.keys()) this.button('keyboard:0', code, false, this.pressedKeys, timestamp);
		for (const code of this.pressedButtons.keys()) this.button('pointer:0', code, false, this.pressedButtons, timestamp);
		this.input.post({ type: 'supervisor-request', down: false, timestamp });
	}
}
