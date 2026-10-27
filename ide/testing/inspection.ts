import { generateUuid } from '../common/uuid';
import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { BuiltFixtureProgram } from './fixture_media';
import { readBlua32CompiledSource, type Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import type { ResourceDomain } from '../common/resource';
import { InspectionValues } from '../runtime/inspection_values';
import { runtimeLuaFrameScopes, type RuntimeLuaFrameScope } from '../runtime/lua_inspection';
import type { RuntimeStackFrame, RuntimeStackTraceFrame } from '../runtime/stack_trace';
import { SuspendedGuestSession } from '../runtime/suspended_guest';
import type { TestStack } from './stack';

type FrameScope = { readonly kind: RuntimeLuaFrameScope['kind']; readonly status: RuntimeLuaFrameScope['status']; readonly reference?: string; readonly count?: number };
type InspectedTestFrame = RuntimeStackTraceFrame & { readonly reference: string; readonly domain: ResourceDomain; readonly pc: number; readonly functionAddress: number };
type FrameEntry = { frame: CallFrame; physical: RuntimeStackFrame; trace: InspectedTestFrame; source?: Blua32CompiledSource; scopes?: readonly FrameScope[] };

/** Owns borrowed test stacks, frames and stored values for one attachment lifetime. */
export abstract class TestInspection {
	public readonly id = generateUuid();
	public readonly globals;
	private readonly values: InspectionValues;
	private readonly stacks = new Map<string, { context: TestStack; frames?: readonly InspectedTestFrame[] }>();
	private readonly frames = new Map<string, FrameEntry>();
	private closed = false;
	private readonly disposalListeners = new Set<() => void>();

	protected constructor(runtime: Runtime, program: BuiltFixtureProgram,
		private detached: (() => void) | undefined) {
		this.values = new InspectionValues(this.id, new SuspendedGuestSession(runtime));
		const globals = [];
		const active = runtime.machine.cpu.activeCartridgeSlot();
		const domains: ResourceDomain[] = active === -1 ? [-1] : [-1, active];
		for (const domain of domains) {
			const image = (domain === -1 ? program.sourceMedia.system : program.sourceMedia.cartridgeSlots[domain])!;
			if (image.symbols === null) globals.push({ domain, sourceContextId: image.sourceContextId, status: 'symbols-unavailable' as const });
			else {
				const names = image.globalRegisterFileByName;
				globals.push({ domain, sourceContextId: image.sourceContextId, status: 'available' as const, count: names.size, reference: this.values.globals(names) });
			}
		}
		this.globals = globals;
	}

	protected addStack(context: TestStack): string {
		const reference = `${this.id}/stack/${this.stacks.size}`;
		this.stacks.set(reference, { context });
		return reference;
	}

	public get available(): boolean { return !this.closed; }
	public onDidDispose(listener: () => void): () => void {
		this.disposalListeners.add(listener);
		return () => this.disposalListeners.delete(listener);
	}
	private requireAvailable(): void {
		if (this.closed) throw new Error('Test inspection expired. Execution resumed, the target was released or the inspection was closed.');
	}

	public readStack(stack: string, start: number, count: number) {
		this.requireAvailable();
		const entry = this.stacks.get(stack);
		if (entry === undefined) throw new Error('Stack handle does not belong to this test inspection.');
		if (entry.frames === undefined) entry.frames = entry.context.frames.map(frame => {
			const physical = entry.context.physical[frame.physicalFrameIndex];
			const reference = `${this.id}/frame/${this.frames.size}`;
			const trace: InspectedTestFrame = { ...frame, reference, domain: physical.executionDomainId,
				pc: physical.tracePc, functionAddress: physical.functionAddress };
			this.frames.set(reference, { frame: entry.context.thread.frames[frame.physicalFrameIndex], physical, trace,
				source: frame.kind === 'source' ? entry.context.sources.get(frame) : undefined });
			return trace;
		});
		return { inspection: this.id, stack, origin: entry.context.origin, source: 'compiled-test-images' as const,
			start, total: entry.frames.length, frames: entry.frames.slice(start, start + count) };
	}

	private frame(reference: string): FrameEntry {
		this.requireAvailable();
		const frame = this.frames.get(reference);
		if (frame === undefined) throw new Error('Frame handle does not belong to this test inspection.');
		return frame;
	}

	public frameScopes(reference: string) {
		const entry = this.frame(reference);
		if (entry.scopes === undefined) entry.scopes = runtimeLuaFrameScopes(entry.physical, entry.trace.inlineDepth).map(scope => {
			if (scope.status !== 'available') return { kind: scope.kind, status: scope.status };
			return { kind: scope.kind, status: scope.status, count: scope.bindings.length,
				reference: this.values.frame(scope.kind, entry.frame, scope.bindings) };
		});
		return { inspection: this.id, frame: reference, scopes: entry.scopes };
	}

	public frameSource(reference: string) {
		const entry = this.frame(reference);
		if (entry.source === undefined) return { inspection: this.id, frame: reference, status: 'source-unmapped' as const };
		return { inspection: this.id, frame: reference, status: 'available' as const, source: 'compiled-test-images' as const,
			path: entry.source.displayPath, text: readBlua32CompiledSource(entry.source) };
	}

	public read(reference: string, start: number, count: number) {
		this.requireAvailable();
		return this.values.read(reference, start, count);
	}

	public dispose(): void {
		if (this.closed) return;
		this.closed = true;
		this.values.dispose(); this.frames.clear(); this.stacks.clear();
		this.detached?.(); this.detached = undefined;
		for (const listener of this.disposalListeners) listener();
		this.disposalListeners.clear();
	}
}
