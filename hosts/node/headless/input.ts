import {
	type InputDevice,
	type InputEventSink,
	type InputEvt,
	type InputHub,
} from '../../common/input/contracts';
import type { MonoTime } from '../../common/clock';

export class HeadlessInputHub implements InputHub {
	private sink: InputEventSink;
	private supervisorRequestLineHigh = false;
	private readonly deviceList: InputDevice[] = [
		{ id: 'keyboard:0', kind: 'keyboard' },
		{ id: 'virtual:0', kind: 'virtual' },
	];

	public subscribe(sink: InputEventSink): () => void {
		this.sink = sink;
		return () => {
			this.sink = null;
		};
	}

	public post(event: InputEvt): void {
		switch (event.type) {
			case 'reset':
				this.sink.resetInput();
				return;
			case 'supervisor-request':
				this.supervisorRequestLineHigh = event.down;
				this.sink.setSupervisorRequestLine(event.down);
				return;
			case 'connect':
				this.sink.connectInputDevice(event.device);
				return;
			case 'disconnect':
				this.sink.disconnectInputDevice(event.deviceId);
				return;
			case 'axis1':
				this.sink.inputAxis1(event.deviceId, event.code, event.x, event.timestamp);
				return;
			case 'axis2':
				this.sink.inputAxis2(event.deviceId, event.code, event.x, event.y, event.timestamp);
				return;
			case 'button':
				if (
					event.deviceId === 'keyboard:0'
					&& event.code === 'F2'
					&& event.down !== this.supervisorRequestLineHigh
				) {
					this.supervisorRequestLineHigh = event.down;
					this.sink.setSupervisorRequestLine(event.down);
				}
				this.sink.inputButton(
					event.deviceId,
					event.code,
					event.down,
					event.value ?? (event.down ? 1 : 0),
					event.timestamp,
					event.pressId || 0,
				);
		}
	}

	public devices(): InputDevice[] {
		return this.deviceList;
	}

	public poll(_time: MonoTime): void { }

	public setKeyboardCapture(_handler: (code: string) => boolean): void { }
}
