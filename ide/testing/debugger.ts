import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { ALL_EXECUTION_DOMAINS_MASK, type ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ResourceDomain } from '../common/resource';
import { RuntimeDebuggerResumeMode, RuntimeDebuggerStopReason, SourceDebugger } from '../runtime/source_debugger';
import { TestDebuggerSources } from './debugger_sources';
import { TestStopInspection } from './stop_inspection';

export type TestPhase = 'initialize' | 'bind' | 'setup' | 'body' | 'teardown' | 'cancel';
export type TestDebugStopReason = 'entry' | 'breakpoint' | 'step' | 'thread-completed' | 'test-boundary' | 'pause';

/** A live test's control/stop lifecycle. TestExecution still owns every CPU grant and its one hook. */
export class TestDebugger {
	public readonly id = crypto.randomUUID();
	public readonly source: SourceDebugger;
	public readonly sources: TestDebuggerSources;
	public status: 'initializing' | 'running' | 'stopped' | 'cancelling' | 'finished' | 'closed' = 'initializing';
	public reason: TestDebugStopReason | undefined;
	public phase: TestPhase = 'initialize';
	public revision = 0;
	private stopThread: Thread | undefined;
	private readonly inspections = new Set<TestStopInspection>();
	private readonly listeners = new Set<() => void>();

	public constructor(private readonly runtime: Runtime, private readonly program: BuiltTestCartridge, private readonly sourceDomain: ResourceDomain,
		bindingChanged: () => void) {
		this.sources = new TestDebuggerSources(this.id, program, sourceDomain, bindingChanged);
		this.source = new SourceDebugger(runtime.machine.cpu, { system: program.debugImages[0].image,
			cartridgeSlots: [program.debugImages[1].image, program.debugImages[2] === null ? null : program.debugImages[2].image] }, this.sources.pcs, bindingChanged);
	}
	public get stopped(): boolean { return this.status === 'stopped'; }
	public get domainMask(): number { return this.stopped ? ALL_EXECUTION_DOMAINS_MASK : this.source.domainMask; }
	public shouldStop(domain: ExecutionDomainId, pc: number): boolean {
		return this.stopped || this.source.stepThreadFinished || this.source.shouldStop(domain, pc);
	}
	public snapshot() {
		const cpu = this.runtime.machine.cpu;
		return { target: this.id, role: 'live-test' as const, status: this.status, reason: this.reason, phase: this.phase, revision: this.revision,
			cycles: this.runtime.machine.scheduler.nowCycles, videoTick: this.runtime.frameScheduler.lastTickSequence,
			thread: (this.stopThread === undefined ? cpu.activeThread : this.stopThread).hashId,
			canContinue: this.canResume(RuntimeDebuggerResumeMode.Continue), canStep: this.canResume(RuntimeDebuggerResumeMode.StepInto), canStepOut: this.canResume(RuntimeDebuggerResumeMode.StepOut),
			stop: this.source.stopped ? { domain: this.source.stopDomain, pc: this.source.stopPc, inlineDepth: this.source.stopInlineDepth } : undefined };
	}
	public admit(): void { this.phase = 'bind'; this.stop('entry'); }
	public canResume(mode: RuntimeDebuggerResumeMode): boolean {
		return this.stopped && (mode === RuntimeDebuggerResumeMode.Continue || this.source.stopped)
			&& (mode !== RuntimeDebuggerResumeMode.StepOut || this.source.canStepOut);
	}
	public resume(mode: RuntimeDebuggerResumeMode): void {
		if (!this.canResume(mode)) throw new Error('Live test debugger cannot resume in this state.');
		this.invalidateInspection();
		this.stopThread = undefined; this.status = 'running'; this.reason = undefined;
		this.source.resume(mode);
		this.changed();
	}
	/** A command owns cancellation only until a later manual/debugger transition supersedes it. */
	public execute(mode: RuntimeDebuggerResumeMode, signal: AbortSignal): Promise<ReturnType<TestDebugger['snapshot']>> {
		signal.throwIfAborted();
		this.resume(mode);
		const revision = this.revision;
		const abort = () => { if (this.revision === revision) this.pause(); };
		signal.addEventListener('abort', abort, { once: true });
		return this.wait(signal).finally(() => signal.removeEventListener('abort', abort));
	}
	public pause(): void {
		if (this.status !== 'running') return;
		this.stop('pause');
	}
	private stop(reason: TestDebugStopReason, thread = this.runtime.machine.cpu.activeThread): void {
		this.stopThread = thread;
		this.status = 'stopped'; this.reason = reason;
		this.source.interrupt();
		this.changed();
	}
	public didExecute(phase: TestPhase, boundary: boolean): void {
		this.phase = phase;
		this.source.didExecute();
		if (this.status !== 'running') return;
		if (this.source.stopped) this.stop(this.source.stopReason === RuntimeDebuggerStopReason.Breakpoint ? 'breakpoint' : 'step');
		else if (this.source.stepThreadFinished) this.stop('thread-completed', this.source.stepThread!);
		else if (boundary && this.source.stepping) this.stop('test-boundary');
	}
	public inspect(): TestStopInspection {
		if (!this.stopped) throw new Error('A live test inspection requires a stopped debugger.');
		const inspection = new TestStopInspection(this.runtime, this.program, this.sourceDomain, this.snapshot(), this.stopThread!,
			() => this.inspections.delete(inspection));
		this.inspections.add(inspection);
		return inspection;
	}
	private invalidateInspection(): void {
		for (const inspection of this.inspections) inspection.dispose();
	}
	/** Observe a real stop/termination without polling. Aborting detaches only this waiter. */
	public wait(signal?: AbortSignal): Promise<ReturnType<TestDebugger['snapshot']>> {
		signal?.throwIfAborted();
		if (this.stopped || this.status === 'finished' || this.status === 'closed') return Promise.resolve(this.snapshot());
		return new Promise((resolve, reject) => {
			const changed = () => {
				if (this.status === 'running' || this.status === 'initializing' || this.status === 'cancelling') return;
				this.listeners.delete(changed); signal?.removeEventListener('abort', abort);
				resolve(this.snapshot());
			};
			const abort = () => { this.listeners.delete(changed); reject(signal!.reason); };
			this.listeners.add(changed); signal?.addEventListener('abort', abort, { once: true });
		});
	}
	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private changed(): void {
		this.revision++;
		for (const listener of this.listeners) listener();
	}
	public finish(phase: TestPhase): void {
		this.invalidateInspection(); this.stopThread = undefined;
		this.phase = phase;
		this.status = 'finished'; this.reason = undefined;
		this.source.reset(); this.changed();
	}
	public releaseForCleanup(): void {
		this.invalidateInspection(); this.stopThread = undefined;
		this.status = 'cancelling'; this.reason = undefined;
		this.source.reset(); this.changed();
	}
	public dispose(): void {
		this.invalidateInspection(); this.stopThread = undefined;
		this.status = 'closed'; this.reason = undefined;
		this.sources.dispose(); this.source.reset(); this.changed(); this.listeners.clear();
	}
}
