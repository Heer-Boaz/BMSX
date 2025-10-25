import { assign_bt, insavegame, WorldObject, type RevivableObjectArgs } from 'bmsx';
import { clamp } from 'bmsx/utils/utils';

type BehaviorSummary = {
	mode: string;
	status: string;
	pulse: number;
	iteration: number;
	hue: number;
	interval: number;
};

@insavegame
@assign_bt('lua_demo_bt')
export class LuaDemoActor extends WorldObject {
	public behavior: BehaviorSummary;

	constructor(opts?: RevivableObjectArgs & { id?: string }) {
		const initOpts = opts ? { ...opts, id: opts.id ?? 'lua_demo_actor' } : { id: 'lua_demo_actor' };
		super(initOpts);
		this.behavior = {
			mode: 'boot',
			status: 'Priming behavior tree...',
			pulse: 0,
			iteration: 0,
			hue: 9,
			interval: 0,
		};
	}

	public resetBehavior(): void {
		this.behavior.mode = 'boot';
		this.behavior.status = 'Priming behavior tree...';
		this.behavior.pulse = 0;
		this.behavior.iteration = 0;
		this.behavior.hue = 9;
		this.behavior.interval = 0;
	}

	public setMode(mode: string): void {
		this.behavior.mode = mode;
	}

	public setBehaviorStatus(status: string): void {
		this.behavior.status = status;
	}

	public adjustPulse(delta: number): number {
		this.behavior.pulse = clamp(this.behavior.pulse + delta, 0, 1);
		return this.behavior.pulse;
	}

	public setPulse(value: number): number {
		this.behavior.pulse = clamp(value, 0, 1);
		return this.behavior.pulse;
	}

	public setHue(hue: number): void {
		const quantized = Math.floor(hue);
		this.behavior.hue = clamp(quantized, 1, 15);
	}

	public incrementIteration(): number {
		this.behavior.iteration += 1;
		return this.behavior.iteration;
	}

	public setCurrentInterval(frames: number): void {
		const quantized = Math.floor(frames);
		this.behavior.interval = clamp(quantized, 0, Number.MAX_SAFE_INTEGER);
	}
}

(globalThis as Record<string, unknown>).LuaDemoActor = LuaDemoActor;
