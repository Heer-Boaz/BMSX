import type { GamepadBinding, GamepadInputMapping, KeyboardBinding, KeyboardInputMapping, PointerBinding, PointerInputMapping } from './models';

export type Device = 'keyboard' | 'gamepad' | 'pointer';

export class MappingContext {
	constructor(
		public id: string,
		public priority: number,
		public enabled: boolean,
		public keyboard: KeyboardInputMapping = {},
		public gamepad: GamepadInputMapping = {},
		public pointer: PointerInputMapping = {},
	) { }
}

export class ContextStack {
	private contexts: MappingContext[] = [];

	push(ctx: MappingContext): void { this.contexts.push(ctx); }
	pop(id?: string): MappingContext {
		if (!id) return this.contexts.pop();
		const i = this.contexts.findIndex(c => c.id === id);
		if (i >= 0) return this.contexts.splice(i, 1)[0];
		return undefined;
	}
	enable(id: string, enabled: boolean): void { const c = this.contexts.find(c => c.id === id); if (c) c.enabled = enabled; }
	setPriority(id: string, priority: number): void { const c = this.contexts.find(c => c.id === id); if (c) c.priority = priority; }

	/** Merge bindings from enabled contexts by ascending priority, deduping while preserving first occurrence */
	getBindings(action: string, device: Device): (KeyboardBinding | GamepadBinding | PointerBinding)[] {
		const out: (KeyboardBinding | GamepadBinding | PointerBinding)[] = [];
		const seen = new Set<string>();
		this.forEachEnabledContextByPriority(ctx => {
			const arr = this.bindingsFor(ctx, device, action);
			if (arr) {
				for (const b of arr) {
					const id = typeof b === 'string' ? b : b.id;
					if (!seen.has(id)) { out.push(b); seen.add(id); }
				}
			}
		});
		return out;
	}

	forEachAction(device: Device, visit: (action: string) => void): void {
		const seen = new Set<string>();
		this.forEachEnabledContextByPriority(ctx => {
			const bindings = this.bindingMapFor(ctx, device);
			for (const action in bindings) {
				if (seen.has(action)) {
					continue;
				}
				seen.add(action);
				visit(action);
			}
		});
	}

	private bindingsFor(ctx: MappingContext, device: Device, action: string): (KeyboardBinding | GamepadBinding | PointerBinding)[] {
		switch (device) {
			case 'keyboard': return ctx.keyboard[action];
			case 'gamepad': return ctx.gamepad[action];
			case 'pointer': return ctx.pointer[action];
		}
	}

	private bindingMapFor(ctx: MappingContext, device: Device): KeyboardInputMapping | GamepadInputMapping | PointerInputMapping {
		switch (device) {
			case 'keyboard': return ctx.keyboard;
			case 'gamepad': return ctx.gamepad;
			case 'pointer': return ctx.pointer;
		}
	}

	private forEachEnabledContextByPriority(visit: (ctx: MappingContext) => void): void {
		let lastPriority: number = null;
		let lastIndex = -1;
		while (true) {
			let next: MappingContext = null;
			let nextPriority: number = null;
			let nextIndex = -1;
			for (let index = 0; index < this.contexts.length; index += 1) {
				const ctx = this.contexts[index];
				if (!ctx.enabled) {
					continue;
				}
				if (lastPriority != null && (ctx.priority < lastPriority || (ctx.priority === lastPriority && index <= lastIndex))) {
					continue;
				}
				if (nextPriority == null || ctx.priority < nextPriority || (ctx.priority === nextPriority && index < nextIndex)) {
					next = ctx;
					nextPriority = ctx.priority;
					nextIndex = index;
				}
			}
			if (!next) {
				return;
			}
			visit(next);
			lastPriority = nextPriority;
			lastIndex = nextIndex;
		}
	}
}
