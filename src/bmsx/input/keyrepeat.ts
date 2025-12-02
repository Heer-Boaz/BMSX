import type { ButtonState } from './inputtypes';

export type ButtonStateResolver = (code: string) => ButtonState;

export class KeyPressLatch {
	private readonly records = new Map<string, number>();

	public accept(code: string, state: ButtonState): boolean {
		if (!state || state.pressed !== true || state.consumed === true) {
			this.records.delete(code);
			return false;
		}
		const pressId = state.pressId ;
		if (pressId !== null) {
			const existing = this.records.get(code);
			if (existing === pressId) {
				return false;
			}
			this.records.set(code, pressId);
			return true;
		}
		if (state.justpressed !== true) {
			return false;
		}
		this.records.set(code, null);
		return true;
	}

	public release(code: string): void {
		this.records.delete(code);
	}

	public reset(): void {
		this.records.clear();
	}
}

export class KeyRepeatController {
	private readonly cooldowns = new Map<string, number>();

	constructor(private readonly initialDelay: number, private readonly repeatInterval: number) { }

	public shouldRepeat(code: string, resolve: ButtonStateResolver, deltaSeconds: number, guards: KeyPressLatch): boolean {
		const state = resolve(code);
		if (!state || state.pressed !== true || state.consumed === true) {
			this.cooldowns.delete(code);
			guards.release(code);
			return false;
		}
		let remaining = this.cooldowns.get(code);
		if (remaining === undefined) {
			remaining = this.initialDelay;
			this.cooldowns.set(code, remaining);
		}
		if (guards.accept(code, state)) {
			this.cooldowns.set(code, this.initialDelay);
			return true;
		}
		remaining -= deltaSeconds;
		if (remaining <= 0) {
			this.cooldowns.set(code, this.repeatInterval);
			return true;
		}
		this.cooldowns.set(code, remaining);
		return false;
	}

	public reset(): void {
		this.cooldowns.clear();
	}
}
