import { generateUuid } from '../common/uuid';
import { FsmTransitionObservation } from './observations/fsm_transition';
import { ActionEffectObservation } from './observations/actioneffect';
import type { ExecutionHook } from '../../machine/ts/machine/cpu/cpu';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { asStringId, valueString, valueToString, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import { ALL_EXECUTION_DOMAINS_MASK, executionDomainBit } from '../../machine/ts/spec/blua32/execution_domain';
import { readSupervisorFaultReport } from '../runtime/fault_state';
import type { BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ScenarioResultService, ScenarioTestResult, ScenarioRunFailure, ScenarioRunMode } from './scenario/result_service';
import type { TestTarget } from './target';
import { TestFailureContext } from './failure_context';
import { TestTargetInspection } from './retained_inspection';
import { TestDebugger, type TestPhase } from './debugger';
import { GuestFixture } from './guest_fixture';
import { FixtureOperations, type FixtureOutput } from './fixture_operations';
import { DEFAULT_FIXTURE_BUDGETS, type FixtureBudgets } from './fixture_budgets';

export type TestBudgets = FixtureBudgets & {
	readonly caseTicks: number;
	readonly caseCycles: number;
};
export type TestExecutionMode = ScenarioRunMode;
export const DEFAULT_TEST_BUDGETS: TestBudgets = {
	...DEFAULT_FIXTURE_BUDGETS,
	caseTicks: 3000,
	caseCycles: 3_386_880_000,
};

type Phase = Exclude<TestPhase, 'initialize'>;
/** Policy over ordinary compiled phase coroutines; never interprets a test's return value. */
export class TestExecution implements FixtureOutput {
	public active = true;
	public readonly debugger: TestDebugger | undefined;
	public bootCycles = 0;
	public phaseCycles = 0;
	private readonly failures: TestFailureContext[] = [];
	private inspections: Set<TestTargetInspection> | undefined;
	private inspectionTarget: string | undefined;
	private readonly fixture: GuestFixture;
	private readonly operations: FixtureOperations;
	private phase: Phase = 'bind';
	private cancelling = false;
	private cleanupStartCycles = 0;
	private fsm: FsmTransitionObservation | null = null;
	private actioneffects: ActionEffectObservation | null = null;
	private readonly callArgs: Value[] = [];
	private startTick = 0;
	private readonly executionHook: ExecutionHook = (domain, pc): boolean => {
		if (!this.fixture.initialized) return this.fixture.observeInitialization(domain, pc);
		if (this.operations.shouldStopAtPublication()) return true;
		return !this.cancelling && this.debugger !== undefined && this.debugger.shouldStop(domain, pc);
	};

	public constructor(
		public readonly target: TestTarget,
		private readonly program: BuiltTestCartridge,
		private readonly results: ScenarioResultService,
		public readonly result: ScenarioTestResult,
		private readonly budgets: TestBudgets = DEFAULT_TEST_BUDGETS,
		private readonly capturedFrame?: (target: TestTarget, label: string) => void,
		mode: TestExecutionMode = 'run',
	) {
		this.fixture = new GuestFixture(target.runtime, program);
		this.operations = new FixtureOperations(target, target.input, this, () => this.bindExecutionHook());
		if (mode === 'debug') this.debugger = new TestDebugger(target.runtime, program, result.test.resource.domain, () => this.bindExecutionHook());
		this.bindExecutionHook();
	}

	/** The runner owns the instrumentation port; source matching cannot replace admission/publication. */
	private bindExecutionHook(): void {
		const runner = !this.active ? 0 : !this.fixture.initialized ? executionDomainBit(0)
			: this.operations.observesPublication ? ALL_EXECUTION_DOMAINS_MASK : 0;
		const source = this.active && this.fixture.initialized && !this.cancelling ? this.debugger?.domainMask ?? 0 : 0;
		const mask = runner | source;
		this.target.runtime.machine.cpu.setExecutionHook(mask === 0 ? null : this.executionHook, mask, runner);
	}

	/** One bounded CPU grant or game grant. The host gets control between grants. */
	public advance(): void {
		this.target.serviceBackend();
		if (this.debugger?.stopped) return;
		const boundary = this.advanceExecution();
		this.debugger?.didExecute(!this.fixture.initialized ? 'initialize' : this.phase, boundary);
	}

	private advanceExecution(): boolean {
		const runtime = this.target.runtime;
		const cpu = runtime.machine.cpu;
		this.fsm?.drain(runtime.frameScheduler.lastTickSequence);
		this.actioneffects?.drain(runtime.frameScheduler.lastTickSequence);
		const machineFault = readSupervisorFaultReport(runtime);
		if (machineFault !== undefined) {
			this.stop(machineFault);
			return false;
		}
		if (!this.fixture.initialized) {
			const before = runtime.machine.scheduler.nowCycles;
			this.fixture.advanceInitialization(Math.min(this.budgets.quantumCycles, this.budgets.bootCycles - this.bootCycles));
			this.bootCycles += runtime.machine.scheduler.nowCycles - before;
			if (this.fixture.entryReached) {
				this.fixture.bind(this.result.test.caseName);
				this.bindExecutionHook();
				this.startTick = runtime.frameScheduler.lastTickSequence;
				this.debugger?.admit();
			} else if (this.bootCycles >= this.budgets.bootCycles) this.stop('Module initialization exceeded its cycle budget');
			return false;
		}
		if (this.cleanupStartCycles !== 0 && runtime.machine.scheduler.nowCycles - this.cleanupStartCycles >= this.budgets.cleanupCycles) {
			this.stop('Cleanup exceeded its cycle budget');
			return false;
		}
		if (!this.cancelling && runtime.machine.scheduler.nowCycles >= this.budgets.caseCycles) {
			this.stop('Case exceeded its machine-cycle budget');
			return false;
		}
		if (!this.cancelling && runtime.frameScheduler.lastTickSequence - this.startTick >= this.budgets.caseTicks) {
			this.stop('Case exceeded its logical-tick budget');
			return false;
		}
		if (this.operations.waiting) {
			return this.operations.advance(this.callArgs, this.budgets.quantumCycles);
		}
		const completed = this.fixture.advance(this.callArgs, Math.min(this.budgets.quantumCycles, this.budgets.phaseCycles - this.phaseCycles));
		this.phaseCycles += this.fixture.lastCallCycles;
		if (completed) {
			if (this.phase === 'bind') {
				this.results.markRunning(this.result);
				this.nextPhase(this.program.suite.setup ? 'setup' : 'body');
				return true;
			}
			const values = runtime.readCompletionValues();
			const outcome = cpu.stringPool.toString(asStringId(values[0] as StringValue));
			if (outcome === 'yielded') {
				this.callArgs.length = 1;
				const unsupported = this.operations.accept(values);
				if (unsupported !== undefined) this.stop(`Unsupported test operation '${unsupported}'`);
			}
			else {
				if (outcome === 'failed') {
					this.results.recordFailure(this.result, this.failure(values[1] as Thread, valueToString(values[2], cpu.stringPool)));
				}
				if (this.phase === 'setup' && outcome === 'returned') this.nextPhase('body');
				else if (this.phase !== 'teardown' && this.program.suite.teardown) this.nextPhase('teardown');
				else this.complete();
			}
			return true;
		} else if (this.phaseCycles >= this.budgets.phaseCycles) this.stop('Phase exceeded its cycle budget');
		return false;
	}

	private nextPhase(phase: Phase): void {
		this.phase = phase;
		if (phase === 'teardown') this.cleanupStartCycles = this.target.runtime.machine.scheduler.nowCycles;
		this.phaseCycles = 0;
		this.callArgs.length = 1;
		this.callArgs[0] = valueString(this.target.runtime.machine.cpu.stringPool.intern(phase));
	}

	public log(tick: number, value: Value): void {
		this.results.appendLog(this.result, tick, valueToString(value, this.target.runtime.machine.cpu.stringPool));
	}
	public captureRequested(tick: number, label: string): void { this.results.requestCapture(this.result, tick, label); }
	public captured(sequence: number, label: string): void {
		this.results.recordPresentation(this.result, sequence);
		this.capturedFrame?.(this.target, label);
	}
	public observeFsm(recorder: Table): void {
		const observation = new FsmTransitionObservation(recorder, this.target.runtime.machine.cpu.stringPool,
			(sequence, time, tick, lane, previous, target, outcome) =>
				this.results.appendFsmTransition(trace, sequence, time, tick, lane, previous, target, outcome));
		const trace = this.results.beginFsmTransitionTrace(this.result, observation.instanceId, observation.machineId);
		this.fsm = observation;
	}
	public observeActionEffects(recorder: Table): void {
		const observation = new ActionEffectObservation(recorder, this.target.runtime.machine.cpu.stringPool, {
			trigger: (sequence, time, tick, effect, outcome) => this.results.appendActionEffectTrigger(trace, sequence, time, tick, effect, outcome),
			activity: (sequence, time, tick, effect, kind, count) => this.results.appendActionEffectActivity(trace, sequence, time, tick, effect, kind, count),
		});
		const trace = this.results.beginActionEffectTrace(this.result, observation.ownerId, observation.definitionId);
		this.actioneffects = observation;
	}

	private failure(thread: Thread, message: string, origin: TestFailureContext['origin'] = 'failed-thread'): ScenarioRunFailure {
		const runtime = this.target.runtime;
		const context = new TestFailureContext(thread, origin, runtime.machine.scheduler.nowCycles,
			runtime.frameScheduler.lastTickSequence, this.program, this.result.test.resource.domain,
			!this.fixture.initialized ? 'initialize' : this.phase, message);
		this.failures.push(context);
		return context.failure;
	}

	public inspect(): TestTargetInspection {
		if (this.active) throw new Error('Test inspection requires a retained, inactive target.');
		if (this.inspections === undefined) this.inspections = new Set();
		if (this.inspectionTarget === undefined) this.inspectionTarget = generateUuid();
		const inspection = new TestTargetInspection(this.inspectionTarget, this.target.runtime, this.program,
			this.result, this.failures, () => this.inspections!.delete(inspection));
		this.inspections.add(inspection);
		return inspection;
	}

	public dispose(): void {
		this.debugger?.dispose();
		if (this.inspections !== undefined) for (const inspection of this.inspections) inspection.dispose();
		this.failures.length = 0;
		this.target.dispose();
	}

	private complete(): void {
		this.fsm?.drain(this.target.runtime.frameScheduler.lastTickSequence);
		this.actioneffects?.drain(this.target.runtime.frameScheduler.lastTickSequence);
		this.active = false;
		this.target.input.reset();
		if (this.cancelling) this.results.cancel(this.result, this.target.runtime.frameScheduler.lastTickSequence);
		else this.results.complete(this.result, this.target.runtime.frameScheduler.lastTickSequence);
		this.debugger?.finish(!this.fixture.initialized ? 'initialize' : this.phase);
		this.bindExecutionHook();
	}

	private stop(message: string): void {
		// An uncooperative continuation is quarantined, not unwound to fake cleanup.
		this.results.recordFailure(this.result, this.failure(this.target.runtime.machine.cpu.activeThread, message, 'quarantined-cpu'));
		this.complete();
	}

	public failRunner(error: unknown): void {
		this.results.fail(this.result, this.target.runtime.frameScheduler.lastTickSequence, {
			phase: 'runner', message: error instanceof Error ? error.message : String(error),
			stackTrace: error instanceof Error ? error.stack : undefined,
		}, null);
		this.active = false;
		this.target.input.reset(); this.debugger?.finish(!this.fixture.initialized ? 'initialize' : this.phase); this.bindExecutionHook();
	}

	public cancel(cooperative = true): void {
		if (cooperative && this.cancelling) return;
		this.cancelling = true;
		this.debugger?.releaseForCleanup();
		const runtime = this.target.runtime;
		const cpu = runtime.machine.cpu;
		if (cooperative && this.phase === 'teardown') return;
		this.target.input.reset();
		if (!cooperative || !this.fixture.initialized || this.fixture.callPending || cpu.readExceptionReturnFrameDepth() !== -1) {
			// There is no safe external call boundary: retain the continuation, never truncate it.
			this.results.recordFailure(this.result, { phase: 'cancel', message: 'Cleanup incomplete: cancelled outside a cooperative phase boundary.' });
			this.complete();
			return;
		}
		this.operations.cancel();
		this.bindExecutionHook();
		const phase = this.phase;
		this.nextPhase('cancel');
		this.cleanupStartCycles = runtime.machine.scheduler.nowCycles;
		this.fixture.cancelPhase(phase);
	}
}
