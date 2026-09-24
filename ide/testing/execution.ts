import { ScenarioFsmTransitionObservation } from './scenario/fsm_transition_observation';
import { ScenarioActionEffectObservation } from './scenario/actioneffect_observation';
import type { ExecutionHook } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { asStringId, valueString, valueToString, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuSuspendedRunResult } from '../../machine/ts/machine/runtime/cpu_executor';
import { ALL_EXECUTION_DOMAINS_MASK, executionDomainBit } from '../../machine/ts/spec/blua32/execution_domain';
import { formatNumberAsHex } from '../../machine/ts/common/byte_hex_string';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE, IO_SYS_SUPERVISOR_FAULT_CAUSE, IO_SYS_SUPERVISOR_FAULT_EPC, IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS, IO_SYS_SUPERVISOR_FAULT_DOMAIN } from '../../machine/ts/spec/bmsx/io';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { TEST_EXECUTION_MODULE_PATH, type BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ScenarioResultService, ScenarioTestResult, ScenarioRunFailure, ScenarioRunMode } from './scenario/result_service';
import type { TestTarget } from './target';
import { TestFailureContext } from './failure_context';
import { TestTargetInspection } from './retained_inspection';
import { TestDebugger, type TestPhase } from './debugger';

export type TestBudgets = {
	readonly quantumCycles: number;
	readonly bootCycles: number;
	readonly phaseCycles: number;
	readonly cleanupCycles: number;
	readonly caseTicks: number;
	readonly caseCycles: number;
};
export type TestExecutionMode = ScenarioRunMode;
export const DEFAULT_TEST_BUDGETS: TestBudgets = {
	quantumCycles: 65536,
	bootCycles: 67_737_600,
	phaseCycles: 33_868_800,
	cleanupCycles: 33_868_800,
	caseTicks: 3000,
	caseCycles: 3_386_880_000,
};

type Phase = Exclude<TestPhase, 'initialize'>;
type Wait =
	| { kind: 'ticks'; target: number }
	| { kind: 'input'; target: number }
	| { kind: 'boundary'; receipt: Table; deadline: number }
	| { kind: 'capture'; tick: number };

/** Policy over ordinary compiled phase coroutines; never interprets a test's return value. */
export class TestExecution {
	public active = true;
	public readonly debugger: TestDebugger | undefined;
	public bootCycles = 0;
	public phaseCycles = 0;
	private readonly failures: TestFailureContext[] = [];
	private inspections: Set<TestTargetInspection> | undefined;
	private inspectionTarget: string | undefined;
	private booting = true;
	private entered = false;
	private phase: Phase = 'bind';
	private resume!: Closure;
	private closePhase!: Closure;
	private cancelling = false;
	private cleanupStartCycles = 0;
	private returnThread!: Thread;
	private returnDepth = 0;
	private callPending = false;
	private wait: Wait | null = null;
	private fsm: ScenarioFsmTransitionObservation | null = null;
	private actioneffects: ScenarioActionEffectObservation | null = null;
	private readonly callArgs: Value[] = [];
	private startTick = 0;
	private readonly reachedKey;
	private readonly executionHook: ExecutionHook = (domain, pc): boolean => {
		const cpu = this.target.runtime.machine.cpu;
		if (this.booting) {
			this.entered = cpu.activeThread === cpu.rootThread
				&& pc === this.program.entryCodeAddress;
			return this.entered;
		}
		if (this.wait?.kind === 'boundary' && this.wait.receipt.getStringKey(this.reachedKey) === true) return true;
		return !this.cancelling && this.debugger !== undefined && this.debugger.shouldStop(domain, pc);
	};

	public constructor(
		public readonly target: TestTarget,
		private readonly program: BuiltTestCartridge,
		private readonly results: ScenarioResultService,
		public readonly result: ScenarioTestResult,
		private readonly budgets: TestBudgets = DEFAULT_TEST_BUDGETS,
		private readonly captured?: (target: TestTarget, label: string) => void,
		mode: TestExecutionMode = 'run',
	) {
		const cpu = target.runtime.machine.cpu;
		this.reachedKey = cpu.stringPool.intern('reached');
		if (mode === 'debug') this.debugger = new TestDebugger(target.runtime, program, result.test.resource.domain, () => this.bindExecutionHook());
		this.bindExecutionHook();
	}

	/** The runner owns the instrumentation port; source matching cannot replace admission/publication. */
	private bindExecutionHook(): void {
		const runner = !this.active ? 0 : this.booting ? executionDomainBit(0)
			: this.wait?.kind === 'boundary' ? ALL_EXECUTION_DOMAINS_MASK : 0;
		const source = this.active && !this.booting && !this.cancelling ? this.debugger?.domainMask ?? 0 : 0;
		const mask = runner | source;
		this.target.runtime.machine.cpu.setExecutionHook(mask === 0 ? null : this.executionHook, mask, runner);
	}

	/** One bounded CPU grant or game grant. The host gets control between grants. */
	public advance(): void {
		this.target.serviceBackend();
		if (this.debugger?.stopped) return;
		const boundary = this.advanceExecution();
		this.debugger?.didExecute(this.booting ? 'initialize' : this.phase, boundary);
	}

	private advanceExecution(): boolean {
		const runtime = this.target.runtime;
		const cpu = runtime.machine.cpu;
		this.fsm?.drain(runtime.frameScheduler.lastTickSequence);
		this.actioneffects?.drain(runtime.frameScheduler.lastTickSequence);
		if (runtime.machine.memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) !== 0) {
			const memory = runtime.machine.memory;
			this.stop(`Machine fault: domain ${memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_DOMAIN) | 0}, `
				+ `cause ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_CAUSE), 8)}, `
				+ `PC ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_EPC), 8)}, `
				+ `address ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS), 8)}.`);
			return false;
		}
		if (this.booting) {
			const before = runtime.machine.scheduler.nowCycles;
			runtime.cpuExecution.runSuspendedUntilDepth(0, Math.min(this.budgets.quantumCycles, this.budgets.bootCycles - this.bootCycles), cpu.rootThread);
			this.bootCycles += runtime.machine.scheduler.nowCycles - before;
			if (this.entered) {
				this.booting = false;
				this.bindExecutionHook();
				this.startTick = runtime.frameScheduler.lastTickSequence;
				const pool = cpu.stringPool;
				const suite = cpu.getGlobalByKey(pool.intern(buildModuleExportSlotName(this.program.suite.modulePath, []))) as Table;
				const execution = cpu.getGlobalByKey(pool.intern(buildModuleExportSlotName(TEST_EXECUTION_MODULE_PATH, []))) as Table;
				this.resume = execution.getStringKey(pool.intern('resume')) as Closure;
				this.closePhase = execution.getStringKey(pool.intern('cancel')) as Closure;
				this.beginCall(execution.getStringKey(pool.intern('bind')) as Closure, [suite, valueString(pool.intern(this.result.test.caseName))]);
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
		if (this.wait !== null) {
			return this.advanceWait();
		}
		if (!this.callPending) {
			// A physical exception must return before a new external phase call.
			const exceptionDepth = cpu.readExceptionReturnFrameDepth();
			if (exceptionDepth !== -1) {
				runtime.cpuExecution.runSuspendedUntilDepth(exceptionDepth, this.budgets.quantumCycles, cpu.activeThread);
				return false;
			}
			this.beginCall(this.resume, this.callArgs);
		}
		const before = runtime.machine.scheduler.nowCycles;
		const status = runtime.cpuExecution.runSuspendedUntilDepth(this.returnDepth, Math.min(this.budgets.quantumCycles, this.budgets.phaseCycles - this.phaseCycles), this.returnThread);
		this.phaseCycles += runtime.machine.scheduler.nowCycles - before;
		if (status === CpuSuspendedRunResult.Completed) {
			this.callPending = false;
			if (this.phase === 'bind') {
				this.results.markRunning(this.result);
				this.nextPhase(this.program.suite.setup ? 'setup' : 'body');
				return true;
			}
			const values = runtime.readCompletionValues();
			const outcome = cpu.stringPool.toString(asStringId(values[0] as StringValue));
			if (outcome === 'yielded') this.acceptOperation(values);
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

	private beginCall(closure: Closure, args: readonly Value[]): void {
		const cpu = this.target.runtime.machine.cpu;
		this.returnThread = cpu.activeThread;
		this.returnDepth = cpu.getFrameDepth();
		cpu.beginCompletionCall(closure, args);
		this.callPending = true;
	}

	private nextPhase(phase: Phase): void {
		this.phase = phase;
		if (phase === 'teardown') this.cleanupStartCycles = this.target.runtime.machine.scheduler.nowCycles;
		this.phaseCycles = 0;
		this.callArgs.length = 1;
		this.callArgs[0] = valueString(this.target.runtime.machine.cpu.stringPool.intern(phase));
	}

	private acceptOperation(values: readonly Value[]): void {
		const runtime = this.target.runtime;
		const pool = runtime.machine.cpu.stringPool;
		const operation = pool.toString(asStringId(values[1] as StringValue));
		const tick = runtime.frameScheduler.lastTickSequence;
		this.callArgs.length = 1;
		switch (operation) {
			case 'fsm': this.fsm = new ScenarioFsmTransitionObservation(values[2] as Table, pool, this.results, this.result); break;
			case 'actioneffects': this.actioneffects = new ScenarioActionEffectObservation(values[2] as Table, pool, this.results, this.result); break;
			case 'log': this.results.appendLog(this.result, tick, valueToString(values[2], pool)); break;
			case 'ticks': this.wait = { kind: 'ticks', target: tick + (values[2] as number) }; break;
			case 'key': this.wait = { kind: 'input', target: this.target.input.key(pool.toString(asStringId(values[2] as StringValue)), values[3] as boolean, values[4] as number | null) }; break;
			case 'press': this.wait = { kind: 'input', target: this.target.input.press(pool.toString(asStringId(values[2] as StringValue)), values[3] as number, values[4] as number | null) }; break;
			case 'boundary':
				this.wait = { kind: 'boundary', receipt: values[2] as Table, deadline: tick + (values[3] as number) };
				this.bindExecutionHook();
				break;
			case 'capture':
				this.results.requestCapture(this.result, tick, pool.toString(asStringId(values[2] as StringValue)));
				this.wait = { kind: 'capture', tick };
				break;
			default: this.stop(`Unsupported test operation '${operation}'`);
		}
	}

	private advanceWait(): boolean {
		const runtime = this.target.runtime;
		const wait = this.wait!;
		let ready: boolean;
		switch (wait.kind) {
			case 'ticks': ready = runtime.frameScheduler.lastTickSequence >= wait.target; break;
			case 'input': ready = this.target.input.samples >= wait.target; break;
			case 'boundary':
				ready = wait.receipt.getStringKey(this.reachedKey) === true || runtime.frameScheduler.lastTickSequence >= wait.deadline;
				if (ready) {
					this.callArgs[1] = wait.receipt.getStringKey(this.reachedKey);
				}
				break;
			case 'capture':
				ready = runtime.frameScheduler.lastTickSequence > wait.tick && this.target.present();
				if (ready) {
					this.results.recordPresentation(this.result, this.target.presenter.presentationSequence);
					const capture = this.result.captures.at(this.result.captures.length - 1);
					this.captured?.(this.target, capture.label);
					this.callArgs[1] = this.target.presenter.presentationSequence;
				}
				break;
		}
		if (ready) {
			this.wait = null;
			if (wait.kind === 'boundary') this.bindExecutionHook();
		}
		else this.target.advanceGame(this.budgets.quantumCycles);
		return ready;
	}

	private failure(thread: Thread, message: string, origin: TestFailureContext['origin'] = 'failed-thread'): ScenarioRunFailure {
		const runtime = this.target.runtime;
		const context = new TestFailureContext(thread, origin, runtime.machine.scheduler.nowCycles,
			runtime.frameScheduler.lastTickSequence, this.program, this.result.test.resource.domain,
			this.booting ? 'initialize' : this.phase, message);
		this.failures.push(context);
		return context.failure;
	}

	public inspect(): TestTargetInspection {
		if (this.active) throw new Error('Test inspection requires a retained, inactive target.');
		if (this.inspections === undefined) this.inspections = new Set();
		if (this.inspectionTarget === undefined) this.inspectionTarget = crypto.randomUUID();
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
		this.debugger?.finish(this.booting ? 'initialize' : this.phase);
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
		this.target.input.reset(); this.debugger?.finish(this.booting ? 'initialize' : this.phase); this.bindExecutionHook();
	}

	public cancel(cooperative = true): void {
		if (cooperative && this.cancelling) return;
		this.cancelling = true;
		this.debugger?.releaseForCleanup();
		const runtime = this.target.runtime;
		const cpu = runtime.machine.cpu;
		if (cooperative && this.phase === 'teardown') return;
		this.target.input.reset();
		if (!cooperative || this.booting || this.callPending || cpu.readExceptionReturnFrameDepth() !== -1) {
			// There is no safe external call boundary: retain the continuation, never truncate it.
			this.results.recordFailure(this.result, { phase: 'cancel', message: 'Cleanup incomplete: cancelled outside a cooperative phase boundary.' });
			this.complete();
			return;
		}
		this.wait = null;
		this.bindExecutionHook();
		const phase = this.phase;
		this.nextPhase('cancel');
		this.cleanupStartCycles = runtime.machine.scheduler.nowCycles;
		this.beginCall(this.closePhase, [valueString(cpu.stringPool.intern(phase))]);
	}
}
