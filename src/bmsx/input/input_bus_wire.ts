import { Platform, InputEvt } from '../core/platform';
import { Input } from './input';

export class EngineInputBridge {
	private unsubscribe: (() => void) | null = null;

	attach(): void {
		const hub = Platform.instance.input;
		this.unsubscribe = hub.subscribe((evt: InputEvt) => Input.instance.handleInputEvent(evt));
	}

	detach(): void {
		if (this.unsubscribe !== null) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}
}
