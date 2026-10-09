import type { ExecutionHook } from '../../machine/ts/machine/cpu/cpu';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import { asStringId, valueString, valueToString, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import { ALL_EXECUTION_DOMAINS_MASK, executionDomainBit } from '../../machine/ts/spec/blua32/execution_domain';
import type { BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ResourceDomain } from '../common/resource';
import { readSupervisorFaultReport } from '../runtime/fault_state';
import { TestFailureContext } from './failure_context';
import { DEFAULT_FIXTURE_BUDGETS, type FixtureBudgets } from './fixture_budgets';
import { FixtureOperations, type FixtureOutput } from './fixture_operations';
import { GuestFixture } from './guest_fixture';
import type { FixtureTarget } from './target';
import type { TestInput } from './input';

export type PlayFixtureState = 'initializing' | 'setup' | 'ready' | 'cleanup' | 'stopped' | 'failed' | 'closed';
export type PlayFixtureBudgets = FixtureBudgets & { readonly setupTicks: number; readonly setupCycles: number };
export const DEFAULT_PLAY_FIXTURE_BUDGETS: PlayFixtureBudgets = {
	...DEFAULT_FIXTURE_BUDGETS, setupTicks: 3000, setupCycles: 3_386_880_000,
};
type Phase = 'bind' | 'setup' | 'teardown' | 'cancel';

/**
 * A shared integration fixture, not a successful TestExecution kept alive.
 * Admission/cleanup grant compiled coroutines; Ready grants nothing. The Play
 * session owns human input, elapsed-time pacing, presentation and history.
 */
export class PlayFixture {
	public state: PlayFixtureState = 'initializing';
	public readonly failures: TestFailureContext[] = [];
	private readonly fixture: GuestFixture;
	private readonly operations: FixtureOperations;
	private readonly args: Value[] = [];
	private phase: Phase = 'bind';
	private bootCycles = 0;
	private phaseCycles = 0;
	private startedTick = 0;
	private startedCycles = 0;
	private cleanupCycles = 0;
	private readonly hook: ExecutionHook = (domain, pc) => !this.fixture.initialized
		? this.fixture.observeInitialization(domain, pc) : this.operations.shouldStopAtPublication();

	public constructor(public readonly target: FixtureTarget, private readonly input: TestInput, public readonly program: BuiltTestCartridge,
		private readonly sourceDomain: ResourceDomain, output: FixtureOutput,
		private readonly budgets: PlayFixtureBudgets = DEFAULT_PLAY_FIXTURE_BUDGETS) {
		if (program.suite.kind !== 'integration') throw new Error('Play requires an integration fixture.');
		this.fixture = new GuestFixture(target.runtime, program);
		this.operations = new FixtureOperations(target, input, output, () => this.bindHook());
		this.bindHook();
	}
	public get admitting(): boolean { return this.state === 'initializing' || this.state === 'setup' || this.state === 'cleanup'; }

	private bindHook(): void {
		const mask = !this.admitting ? 0 : !this.fixture.initialized ? executionDomainBit(0)
			: this.operations.observesPublication ? ALL_EXECUTION_DOMAINS_MASK : 0;
		this.target.runtime.machine.cpu.setExecutionHook(mask === 0 ? null : this.hook, mask, mask);
	}

	public advance(): void {
		if (!this.admitting) return;
		this.target.serviceBackend();
		const runtime = this.target.runtime, cpu = runtime.machine.cpu;
		const machineFault = readSupervisorFaultReport(runtime);
		if (machineFault !== undefined) { this.quarantine(machineFault); return; }
		if (!this.fixture.initialized) {
			const before = runtime.machine.scheduler.nowCycles;
			this.fixture.advanceInitialization(Math.min(this.budgets.quantumCycles, this.budgets.bootCycles - this.bootCycles));
			this.bootCycles += runtime.machine.scheduler.nowCycles - before;
			if (this.fixture.entryReached) {
				this.fixture.bind(null);
				this.state = 'setup';
				this.startedTick = runtime.frameScheduler.lastTickSequence;
				this.startedCycles = runtime.machine.scheduler.nowCycles;
				this.bindHook();
			} else if (this.bootCycles >= this.budgets.bootCycles) this.quarantine('Module initialization exceeded its cycle budget');
			return;
		}
		if (this.state === 'cleanup') {
			if (runtime.machine.scheduler.nowCycles - this.cleanupCycles >= this.budgets.cleanupCycles) {
				this.quarantine('Cleanup exceeded its cycle budget'); return;
			}
		} else if (runtime.machine.scheduler.nowCycles - this.startedCycles >= this.budgets.setupCycles
			|| runtime.frameScheduler.lastTickSequence - this.startedTick >= this.budgets.setupTicks) {
			this.quarantine('Fixture setup exceeded its execution budget'); return;
		}
		if (this.operations.waiting) { this.operations.advance(this.args, this.budgets.quantumCycles); return; }
		const completed = this.fixture.advance(this.args, Math.min(this.budgets.quantumCycles, this.budgets.phaseCycles - this.phaseCycles));
		this.phaseCycles += this.fixture.lastCallCycles;
		if (!completed) {
			if (this.phaseCycles >= this.budgets.phaseCycles) this.quarantine('Fixture phase exceeded its cycle budget');
			return;
		}
		if (this.phase === 'bind') {
			if (this.program.suite.setup) this.nextPhase('setup');
			else this.ready();
			return;
		}
		const values = runtime.readCompletionValues();
		const outcome = cpu.stringPool.toString(asStringId(values[0] as StringValue));
		if (outcome === 'yielded') {
			this.args.length = 1;
			const unsupported = this.operations.accept(values);
			if (unsupported !== undefined) this.quarantine(`Unsupported fixture operation '${unsupported}'`);
			return;
		}
		if (outcome === 'failed') this.recordFailure(values[1] as Thread, valueToString(values[2], cpu.stringPool), 'failed-thread');
		if (this.phase === 'setup' && outcome === 'returned') this.ready();
		else if (this.phase !== 'teardown') this.beginCleanup();
		else this.finish();
	}

	private nextPhase(phase: Phase): void {
		this.phase = phase; this.phaseCycles = 0;
		this.args.length = 1; this.args[0] = valueString(this.target.runtime.machine.cpu.stringPool.intern(phase));
	}
	private ready(): void {
		this.input.reset(); this.state = 'ready'; this.bindHook();
	}
	private beginCleanup(): void {
		this.input.reset(); this.operations.cancel();
		if (this.state !== 'cleanup') this.cleanupCycles = this.target.runtime.machine.scheduler.nowCycles;
		this.state = 'cleanup';
		if (this.program.suite.teardown) this.nextPhase('teardown');
		else this.finish();
	}
	private finish(): void {
		this.input.reset(); this.operations.cancel();
		this.state = this.failures.length === 0 ? 'stopped' : 'failed'; this.bindHook();
	}
	private recordFailure(thread: Thread, message: string, origin: TestFailureContext['origin']): void {
		const runtime = this.target.runtime;
		this.failures.push(new TestFailureContext(thread, origin, runtime.machine.scheduler.nowCycles,
			runtime.frameScheduler.lastTickSequence, this.program, this.sourceDomain, !this.fixture.initialized ? 'initialize' : this.phase, message));
	}
	private quarantine(message: string): void {
		this.recordFailure(this.target.runtime.machine.cpu.activeThread, message, 'quarantined-cpu'); this.finish();
	}

	/** Stop tears down an admitted world; an unsafe continuation is retained, not unwound. */
	public stop(): void {
		if (this.state === 'stopped' || this.state === 'failed' || this.state === 'closed' || this.state === 'cleanup') return;
		if (this.state === 'ready') { this.beginCleanup(); return; }
		const cpu = this.target.runtime.machine.cpu;
		if (!this.fixture.initialized || this.fixture.callPending || cpu.readExceptionReturnFrameDepth() !== -1) {
			this.quarantine('Cleanup incomplete: stopped outside a cooperative fixture boundary.'); return;
		}
		this.input.reset(); this.operations.cancel();
		const phase = this.phase;
		this.state = 'cleanup'; this.cleanupCycles = this.target.runtime.machine.scheduler.nowCycles;
		this.nextPhase('cancel'); this.fixture.cancelPhase(phase); this.bindHook();
	}

	public dispose(): void {
		if (this.state === 'closed') return;
		this.state = 'closed'; this.operations.cancel(); this.bindHook(); this.target.dispose();
		this.failures.length = 0;
	}
}
