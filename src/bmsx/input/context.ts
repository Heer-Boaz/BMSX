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
		const active = this.contexts.filter(c => c.enabled).sort((a, b) => a.priority - b.priority);
		const out: (KeyboardBinding | GamepadBinding | PointerBinding)[] = [];
		const seen = new Set<string>();
		for (const c of active) {
			if (device === 'keyboard') {
				if (!c.keyboard) {
					throw new Error(`[ContextStack] Mapping context '${c.id}' is missing keyboard bindings.`);
				}
				const arr = c.keyboard[action] ?? [];
				for (const b of arr) {
					const id = typeof b === 'string' ? b : b.id;
					if (!seen.has(id)) { out.push(b); seen.add(id); }
				}
			} else if (device === 'gamepad') {
				if (!c.gamepad) {
					throw new Error(`[ContextStack] Mapping context '${c.id}' is missing gamepad bindings.`);
				}
				const arr = c.gamepad[action] ?? [];
				for (const b of arr) {
					const id = typeof b === 'string' ? b : b.id;
					if (!seen.has(id)) { out.push(b); seen.add(id); }
				}
			} else if (device === 'pointer') {
				if (!c.pointer) {
					throw new Error(`[ContextStack] Mapping context '${c.id}' is missing pointer bindings.`);
				}
				const arr = c.pointer[action] ?? [];
				for (const b of arr) {
					const id = typeof b === 'string' ? b : b.id;
					if (!seen.has(id)) { out.push(b); seen.add(id); }
				}
			}
		}
		return out;
	}
}
