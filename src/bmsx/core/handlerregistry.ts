export type GenericHandler = (this: any, ...args: any[]) => any;

export type HandlerCategory = 'fsm' | 'behavior_tree' | 'component' | 'event' | 'world' | 'other';

export type SlotKind = 'single' | 'multicast';

export interface HandlerDescriptor {
	id: string;
	category: HandlerCategory;
	target?: {
		machine?: string;
		tree?: string;
		component?: string;
		entity?: string;
		state?: string;
		hook?: string;
	};
	source?: {
		lang: 'lua' | 'js';
		module: string;
		symbol: string;
		lineStart?: number;
		lineEnd?: number;
		hash?: string;
	};
	version?: number;
	listenerOf?: string;
	priority?: number;
	once?: boolean;
}

type SingleEntry = {
	stub: GenericHandler;
	impl: GenericHandler;
	desc: HandlerDescriptor;
};

type SlotEntry = {
	stub: GenericHandler;
	listeners: Array<{ id: string; priority: number; once: boolean }>;
	version: number;
};

type ListenerEntry = {
	impl: GenericHandler;
	desc: HandlerDescriptor;
};

export interface LuaHotReloadCompilationResult {
	exports: Record<string, GenericHandler>;
	finalize?(result: { updated: string[]; removed: string[]; unchanged: string[] }): void;
}

export interface LuaHandlerMeta {
	module: string;
	symbol: string;
	lineStart?: number;
	lineEnd?: number;
	hash?: string;
}

export interface LuaHandlerExtra {
	category?: HandlerCategory;
	target?: HandlerDescriptor['target'];
}

export interface LuaSubscriptionExtra extends LuaHandlerExtra {
	id?: string;
	priority?: number;
	once?: boolean;
}

export class HandlerRegistry {
	public static readonly instance = new HandlerRegistry();

	private readonly singles = new Map<string, SingleEntry>();
	private readonly slots = new Map<string, SlotEntry>();
	private readonly listeners = new Map<string, ListenerEntry>();
	private readonly byModule = new Map<string, Set<string>>();

	public static readonly STOP = Symbol('handler:stop');

	public register(id: string, fn: GenericHandler): GenericHandler;
	public register(desc: HandlerDescriptor, fn: GenericHandler): GenericHandler;
	public register(idOrDesc: string | HandlerDescriptor, fn: GenericHandler): GenericHandler {
		const desc: HandlerDescriptor = typeof idOrDesc === 'string'
			? {
				id: idOrDesc,
				category: 'other',
				source: { lang: 'js', module: 'inline', symbol: idOrDesc },
			}
			: idOrDesc;

		const existing = this.singles.get(desc.id);
		if (!existing) {
			const id = desc.id;
			const registry = this;
			const stub: GenericHandler = function (this: any, ...args: any[]) {
				const record = registry.singles.get(id);
				if (!record) throw new Error(`Handler '${id}' missing`);
				return record.impl.apply(this, args);
			};
			const entry: SingleEntry = {
				stub,
				impl: fn,
				desc: { ...desc, version: 1 },
			};
			this.singles.set(desc.id, entry);
			this.index(entry.desc);
			return stub;
		}

		const previousModule = existing.desc.source?.module;
		existing.impl = fn;
		existing.desc = { ...desc, version: (existing.desc.version ?? 0) + 1 };
		this.index(existing.desc, previousModule);
		return existing.stub;
	}

	public get(id: string): GenericHandler {
		const single = this.singles.get(id);
		if (single) return single.stub;
		const slot = this.slots.get(id);
		if (slot) return slot.stub;
		return undefined;
	}

	public describe(id: string): HandlerDescriptor {
		const single = this.singles.get(id);
		if (single) return single.desc;
		const listener = this.listeners.get(id);
		if (listener) return listener.desc;
		return undefined;
	}

	public listByModule(moduleId: string): string[] {
		const ids = this.byModule.get(moduleId);
		return ids ? Array.from(ids) : [];
	}

	public unregister(id: string): void {
		const single = this.singles.get(id);
		if (single) {
			const moduleId = single.desc.source?.module;
			if (moduleId) {
				const bucket = this.byModule.get(moduleId);
				if (bucket) bucket.delete(id);
			}
			this.singles.delete(id);
			return;
		}
		this.removeListenerById(id);
	}

	public on(slotId: string, listenerDesc: Omit<HandlerDescriptor, 'listenerOf'>, fn: GenericHandler, opts?: { priority?: number; once?: boolean }): () => void {
		const slot = this.ensureSlot(slotId);
		const baseId = listenerDesc.id ?? this.buildListenerBaseId(slotId, listenerDesc.source);
		const id = this.resolveUniqueListenerId(baseId);
		const priority = opts?.priority ?? listenerDesc.priority ?? 0;
		const once = !!(opts?.once ?? listenerDesc.once);
		const desc: HandlerDescriptor = {
			...listenerDesc,
			id,
			listenerOf: slotId,
			category: listenerDesc.category ?? 'event',
			priority,
			once,
		};

		this.listeners.set(id, {
			impl: fn,
			desc: { ...desc, version: 1 },
		});
		this.index(desc);

		const insert = { id, priority, once };
		const listeners = slot.listeners;
		let index = 0;
		while (index < listeners.length && listeners[index].priority >= priority) index += 1;
		listeners.splice(index, 0, insert);
		slot.version += 1;

		return () => this.off(slotId, id);
	}

	public off(slotId: string, listenerId: string): void {
		const slot = this.slots.get(slotId);
		if (!slot) return;
		const listeners = slot.listeners;
		for (let i = 0; i < listeners.length; i += 1) {
			const record = listeners[i];
			if (record.id !== listenerId) continue;
			listeners.splice(i, 1);
			slot.version += 1;
			break;
		}
		this.removeListenerById(listenerId);
	}

	public swapByModule(module: string, resolver: (desc: HandlerDescriptor) => GenericHandler): {
		updated: string[];
		removed: string[];
		unchanged: string[];
	} {
		const ids = this.byModule.get(module);
		if (!ids || ids.size === 0) {
			return { updated: [], removed: [], unchanged: [] };
		}

		const updated: string[] = [];
		const removed: string[] = [];
		const unchanged: string[] = [];

		const plan: Array<{ id: string; kind: 'single' | 'listener'; next: GenericHandler }> = [];
		for (const id of ids) {
			if (this.singles.has(id)) {
				const single = this.singles.get(id)!;
				const next = resolver(single.desc);
				plan.push({ id, kind: 'single', next });
				continue;
			}
			if (this.listeners.has(id)) {
				const listener = this.listeners.get(id)!;
				const next = resolver(listener.desc);
				plan.push({ id, kind: 'listener', next });
			}
		}

		for (const step of plan) {
			if (step.kind === 'single') {
				const single = this.singles.get(step.id);
				if (!single) continue;
				if (step.next) {
					if (step.next !== single.impl) {
						single.impl = step.next;
						single.desc.version = (single.desc.version ?? 0) + 1;
						updated.push(step.id);
					} else {
						unchanged.push(step.id);
					}
					continue;
				}
			const moduleName = single.desc.source?.module ?? module;
			single.impl = this.createRemovedTrap(step.id, moduleName, single.desc.source?.symbol);
			single.desc.version = (single.desc.version ?? 0) + 1;
			updated.push(step.id);
			removed.push(step.id);
			continue;
		}

			const listener = this.listeners.get(step.id);
			if (!listener) continue;
			if (step.next) {
				if (step.next !== listener.impl) {
					listener.impl = step.next;
					listener.desc.version = (listener.desc.version ?? 0) + 1;
					updated.push(step.id);
				} else {
					unchanged.push(step.id);
				}
				continue;
			}
			if (listener.desc.listenerOf) {
				this.off(listener.desc.listenerOf, listener.desc.id);
			} else {
				this.removeListenerById(listener.desc.id);
			}
			removed.push(listener.desc.id);
		}

		return { updated, removed, unchanged };
	}

	private createRemovedTrap(id: string, module: string, symbol?: string): GenericHandler {
		return function removedTrap() {
			throw new Error(`Handler '${id}'${symbol ? ` (symbol '${symbol}')` : ''} no longer exists in module '${module}'`);
		};
	}

	private ensureSlot(slotId: string): SlotEntry {
		const existing = this.slots.get(slotId);
		if (existing) return existing;

		const registry = this;
		const stub: GenericHandler = function (this: any, ...args: any[]) {
			const slot = registry.slots.get(slotId);
			if (!slot) return undefined;
			const snapshot = slot.listeners.slice();
			let last: any = undefined;
			for (let index = 0; index < snapshot.length; index += 1) {
				const rec = snapshot[index];
				const listener = registry.listeners.get(rec.id);
				if (!listener) continue;
				const result = listener.impl.apply(this, args);
				last = result;
				if (result === HandlerRegistry.STOP) break;
				if (rec.once) registry.off(slotId, rec.id);
			}
			return last;
		};

		const slot: SlotEntry = { stub, listeners: [], version: 1 };
		this.slots.set(slotId, slot);
		return slot;
	}

	private buildListenerBaseId(slotId: string, source?: HandlerDescriptor['source']): string {
		if (!source) return `${slotId}::anon`;
		return `${slotId}::${source.module}::${source.symbol}`;
	}

	private resolveUniqueListenerId(base: string): string {
		let id = base;
		let index = 1;
		while (this.listeners.has(id)) {
			index += 1;
			id = `${base}#${index}`;
		}
		return id;
	}

	private removeListenerById(listenerId: string): void {
		const entry = this.listeners.get(listenerId);
		if (!entry) return;
		const slotId = entry.desc.listenerOf;
		if (slotId) {
			const slot = this.slots.get(slotId);
			if (slot) {
				const listeners = slot.listeners;
				for (let i = 0; i < listeners.length; i += 1) {
					if (listeners[i].id !== listenerId) continue;
					listeners.splice(i, 1);
					slot.version += 1;
					break;
				}
			}
		}
		const moduleId = entry.desc.source?.module;
		if (moduleId) {
			const bucket = this.byModule.get(moduleId);
			if (bucket) {
				bucket.delete(listenerId);
				if (bucket.size === 0) this.byModule.delete(moduleId);
			}
		}
		this.listeners.delete(listenerId);
	}

	private index(desc: HandlerDescriptor, previousModule?: string): void {
		if (previousModule && previousModule !== desc.source?.module) {
			const bucket = this.byModule.get(previousModule);
			if (bucket) {
				bucket.delete(desc.id);
				if (bucket.size === 0) this.byModule.delete(previousModule);
			}
		}
		const moduleId = desc.source?.module;
		if (!moduleId) return;
		let bucket = this.byModule.get(moduleId);
		if (!bucket) {
			bucket = new Set<string>();
			this.byModule.set(moduleId, bucket);
		}
		bucket.add(desc.id);
	}
}

export function registerLuaHandler(
	id: string,
	fn: GenericHandler,
	meta: LuaHandlerMeta,
	extra?: LuaHandlerExtra
): GenericHandler {
	const symbol = meta.symbol?.trim();
	if (!symbol || symbol === '<anonymous>') {
		throw new Error(`[HandlerRegistry] Lua handler '${id}' requires a stable non-anonymous symbol.`);
	}
	const moduleName = meta.module?.trim();
	if (!moduleName) {
		throw new Error(`[HandlerRegistry] Lua handler '${id}' requires a module identifier.`);
	}
	const desc: HandlerDescriptor = {
		id,
		category: extra?.category ?? 'other',
		target: extra?.target,
		source: { lang: 'lua', ...meta },
	};
	return HandlerRegistry.instance.register(desc, fn);
}

export function subscribeLua(
	slotId: string,
	fn: GenericHandler,
	meta: LuaHandlerMeta,
	extra?: LuaSubscriptionExtra
): () => void {
	const desc: HandlerDescriptor = {
		id: extra?.id ?? `${slotId}::${meta.module}::${meta.symbol}`,
		category: extra?.category ?? 'event',
		target: extra?.target,
		source: { lang: 'lua', ...meta },
		priority: extra?.priority,
		once: extra?.once,
	};
	return HandlerRegistry.instance.on(slotId, desc, fn, { priority: extra?.priority, once: extra?.once });
}

export class LuaHotReloader {
	constructor(
		private readonly lua: { compileAndLoad(moduleId: string, source: string): LuaHotReloadCompilationResult },
		private readonly registry: HandlerRegistry = HandlerRegistry.instance
	) {}

	reloadModule(moduleId: string, source: string) {
		const { exports, finalize } = this.lua.compileAndLoad(moduleId, source);
		const result = this.registry.swapByModule(moduleId, (desc) => {
			if (desc.source?.lang !== 'lua') return null;
			if (desc.source.module !== moduleId) return null;
			const next = exports[desc.source.symbol];
			if (typeof next !== 'function') return null;
			return next as GenericHandler;
		});
		finalize?.(result);
		return result;
	}
}
