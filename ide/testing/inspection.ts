import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { readTestDebugSource, type BuiltTestCartridge, type TestDebugSource } from '../../toolchain/ts/rompack/test_cartridge';
import type { ResourceDomain } from '../common/resource';
import { InspectionValues } from '../runtime/inspection_values';
import { runtimeLuaFrameScopes, type RuntimeLuaFrameScope } from '../runtime/lua_inspection';
import { createBlua32SourceImage } from '../runtime/sources';
import type { RuntimeStackFrame, RuntimeStackTraceFrame } from '../runtime/stack_trace';
import { SuspendedGuestSession } from '../runtime/suspended_guest';
import type { TestFailureContext } from './failure_context';
import type { ScenarioTestResult } from './scenario/result_service';

type FrameScope = { readonly kind: RuntimeLuaFrameScope['kind']; readonly status: RuntimeLuaFrameScope['status']; readonly reference?: string; readonly count?: number };
type InspectedTestFrame = RuntimeStackTraceFrame & { readonly reference: string; readonly domain: ResourceDomain; readonly pc: number; readonly functionAddress: number };
type FrameEntry = { frame: CallFrame; physical: RuntimeStackFrame; trace: InspectedTestFrame; source?: TestDebugSource; scopes?: readonly FrameScope[] };

/** Read-only attachment to one retained physical test. Never redirects authoring/debugger services. */
export class TestTargetInspection {
	public readonly id = crypto.randomUUID();
	public readonly state;
	private readonly values: InspectionValues;
	private readonly failures = new Map<string, { context: TestFailureContext; stack?: readonly InspectedTestFrame[] }>();
	private readonly frames = new Map<string, FrameEntry>();
	private closed = false;
	private readonly disposalListeners = new Set<() => void>();

	public constructor(target: string, runtime: Runtime, program: BuiltTestCartridge, result: ScenarioTestResult,
		contexts: readonly TestFailureContext[], private detached: (() => void) | undefined) {
		this.values = new InspectionValues(this.id, new SuspendedGuestSession(runtime));
		const globals = [];
		const active = runtime.machine.cpu.activeCartridgeSlot();
		const domains: ResourceDomain[] = active === -1 ? [-1] : [-1, active];
		for (const domain of domains) {
			const image = program.debugImages[domain + 1]!.image;
			const sourceDomain: ResourceDomain = domain === -1 ? -1 : (domain ^ result.test.resource.domain) as 0 | 1;
			if (image.symbols === null) globals.push({ domain, sourceDomain, status: 'symbols-unavailable' as const });
			else {
				const names = createBlua32SourceImage(image.layout, image.symbols).globalRegisterFileByName;
				globals.push({ domain, sourceDomain, status: 'available' as const, count: names.size, reference: this.values.globals(names) });
			}
		}
		this.state = { inspection: this.id, target, role: 'retained-test' as const, mode: 'post-mortem' as const,
			heap: 'retained-at-case-end' as const, source: 'compiled-test-images' as const,
			canResume: false, canStep: false, canEvaluate: false,
			cycles: runtime.machine.scheduler.nowCycles, videoTick: runtime.frameScheduler.lastTickSequence, globals,
			failures: result.failures.map((failure, index) => {
				const context = contexts.find(entry => entry.failure === failure);
				if (context === undefined) return { index, phase: failure.phase, message: failure.message, status: 'no-retained-guest-thread' as const };
				if (context.thread.status === ThreadStatus.Dead) return { index, phase: failure.phase, message: failure.message, status: 'thread-closed' as const };
				const reference = `${this.id}/failure/${index}`;
				this.failures.set(reference, { context });
				return { index, phase: failure.phase, message: failure.message, status: 'available' as const, reference,
					origin: context.origin, cycles: context.cycles, videoTick: context.videoTick };
			}),
		};
	}

	public get available(): boolean { return !this.closed; }
	public onDidDispose(listener: () => void): () => void {
		this.disposalListeners.add(listener);
		return () => this.disposalListeners.delete(listener);
	}
	private requireRetained(): void {
		if (this.closed) throw new Error('Test inspection expired. The target was released or the inspection was closed.');
	}

	public readStack(failure: string, start: number, count: number) {
		this.requireRetained();
		const entry = this.failures.get(failure);
		if (entry === undefined) throw new Error('Failure handle does not belong to this test inspection.');
		if (entry.stack === undefined) entry.stack = entry.context.frames.map(frame => {
			const physical = entry.context.physical[frame.physicalFrameIndex];
			const reference = `${this.id}/frame/${this.frames.size}`;
			const trace: InspectedTestFrame = { ...frame, reference, domain: physical.executionDomainId,
				pc: physical.tracePc, functionAddress: physical.functionAddress };
			this.frames.set(reference, { frame: entry.context.thread.frames[frame.physicalFrameIndex], physical, trace,
				source: entry.context.sources.get(frame) });
			return trace;
		});
		return { inspection: this.id, failure, origin: entry.context.origin, source: 'compiled-test-images' as const,
			start, total: entry.stack.length, frames: entry.stack.slice(start, start + count) };
	}

	private frame(reference: string): FrameEntry {
		this.requireRetained();
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
			path: entry.source.displayPath, text: readTestDebugSource(entry.source) };
	}

	public read(reference: string, start: number, count: number) {
		this.requireRetained();
		return this.values.read(reference, start, count);
	}

	public dispose(): void {
		if (this.closed) return;
		this.closed = true;
		this.values.dispose(); this.frames.clear(); this.failures.clear();
		this.detached?.(); this.detached = undefined;
		for (const listener of this.disposalListeners) listener();
		this.disposalListeners.clear();
	}
}
