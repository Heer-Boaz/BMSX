import type { LuaSourceRange } from '../lua/ast';
import type { LuaInterpreter } from '../lua/runtime';
import type { LuaFunctionValue } from '../lua/value';

export type LuaHandlerCategory = string;

export type LuaHandlerBindContext = {
	fn: LuaFunctionValue;
	interpreter: LuaInterpreter;
};

export interface LuaHandlerDescriptor {
	id: string;
	category: LuaHandlerCategory;
	targetId: string;
	hook: string;
	chunkName: string | null;
	normalizedChunkName: string;
	functionName: string | null;
	sourceRange: LuaSourceRange | null;
	metadata?: Readonly<Record<string, unknown>>;
}

export interface LuaHandlerRegistration {
	id: string;
	category: LuaHandlerCategory;
	targetId: string;
	hook: string;
	chunkName?: string | null;
	functionName: string | null;
	sourceRange: LuaSourceRange | null;
	metadata?: Readonly<Record<string, unknown>>;
	onCreate(context: LuaHandlerBindContext): void;
	onUpdate(context: LuaHandlerBindContext): void;
	onDispose(context: LuaHandlerBindContext): void;
}

type LuaHandlerRecord = {
	descriptor: LuaHandlerDescriptor;
	context: LuaHandlerBindContext;
	onUpdate: (context: LuaHandlerBindContext) => void;
	onDispose: (context: LuaHandlerBindContext) => void;
};

export class LuaHandlerRegistry {
	public static readonly instance = new LuaHandlerRegistry();

	private readonly records = new Map<string, LuaHandlerRecord>();
	private readonly handlerIdsByChunk = new Map<string, Set<string>>();

	public register(registration: LuaHandlerRegistration, context: LuaHandlerBindContext): LuaHandlerDescriptor {
		const descriptor = this.createDescriptor(registration);
		const existing = this.records.get(registration.id);
		if (existing) {
			this.reindexDescriptor(existing.descriptor, descriptor);
			existing.descriptor = descriptor;
			existing.onUpdate(context);
			existing.context = context;
			return descriptor;
		}

		registration.onCreate(context);
		this.records.set(registration.id, {
			descriptor,
			context,
			onUpdate: registration.onUpdate,
			onDispose: registration.onDispose,
		});
		this.indexDescriptor(descriptor);
		return descriptor;
	}

	public unregister(handlerId: string): void {
		const record = this.records.get(handlerId);
		if (!record) {
			return;
		}
		this.unindexDescriptor(record.descriptor);
		try {
			record.onDispose(record.context);
		}
		finally {
			this.records.delete(handlerId);
		}
	}

	public get(handlerId: string): LuaHandlerDescriptor | null {
		const record = this.records.get(handlerId);
		return record ? record.descriptor : null;
	}

	public list(): ReadonlyArray<LuaHandlerDescriptor> {
		return Array.from(this.records.values(), (record) => record.descriptor);
	}

	public listByChunk(chunkName: string): ReadonlyArray<LuaHandlerDescriptor> {
		const ids = this.handlerIdsByChunk.get(chunkName);
		if (!ids || ids.size === 0) {
			return [];
		}
		const descriptors: LuaHandlerDescriptor[] = [];
		for (const handlerId of ids) {
			const record = this.records.get(handlerId);
			if (record) {
				descriptors.push(record.descriptor);
			}
		}
		return descriptors;
	}

	private createDescriptor(registration: LuaHandlerRegistration): LuaHandlerDescriptor {
		const baseChunk = registration.chunkName ?? registration.sourceRange?.chunkName ?? '';
		const normalizedChunkName = baseChunk;
		return {
			id: registration.id,
			category: registration.category,
			targetId: registration.targetId,
			hook: registration.hook,
			chunkName: baseChunk,
			normalizedChunkName,
			functionName: registration.functionName,
			sourceRange: registration.sourceRange,
			metadata: registration.metadata,
		};
	}

	private indexDescriptor(descriptor: LuaHandlerDescriptor): void {
		let bucket = this.handlerIdsByChunk.get(descriptor.normalizedChunkName);
		if (!bucket) {
			bucket = new Set<string>();
			this.handlerIdsByChunk.set(descriptor.normalizedChunkName, bucket);
		}
		bucket.add(descriptor.id);
	}

	private unindexDescriptor(descriptor: LuaHandlerDescriptor): void {
		const chunk = descriptor.normalizedChunkName;
		const bucket = this.handlerIdsByChunk.get(chunk);
		if (!bucket) {
			return;
		}
		bucket.delete(descriptor.id);
		if (bucket.size === 0) {
			this.handlerIdsByChunk.delete(chunk);
		}
	}

	private reindexDescriptor(previous: LuaHandlerDescriptor, next: LuaHandlerDescriptor): void {
		if (previous.normalizedChunkName === next.normalizedChunkName) {
			return;
		}
		this.unindexDescriptor(previous);
		this.indexDescriptor(next);
	}
}
