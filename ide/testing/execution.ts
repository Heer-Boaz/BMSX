import { ScenarioFsmTransitionObservation } from './scenario/fsm_transition_observation';
import { ScenarioActionEffectObservation } from './scenario/actioneffect_observation';
import type { ResourceDomain } from '../common/resource';
import type { ExecutionHook } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { asStringId, valueString, valueToString, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuSuspendedRunResult } from '../../machine/ts/machine/runtime/cpu_executor';
import { ALL_EXECUTION_DOMAINS_MASK, executionDomainBit } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { formatNumberAsHex } from '../../machine/ts/common/byte_hex_string';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE, IO_SYS_SUPERVISOR_FAULT_CAUSE, IO_SYS_SUPERVISOR_FAULT_EPC, IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS, IO_SYS_SUPERVISOR_FAULT_DOMAIN } from '../../machine/ts/spec/bmsx/io';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { buildLuaStackFrames } from '../runtime/stack_trace';
import { TEST_EXECUTION_MODULE_PATH, type BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ScenarioResultService, ScenarioTestResult, ScenarioRunFailure } from './scenario/result_service';
import type { TestTarget } from './target';

export type TestBudgets = {
	readonly quantumCycles: number;
	readonly bootCycles: number;
	readonly phaseCycles: number;
	readonly cleanupCycles: number;
	readonly caseTicks: number;
	readonly caseCycles: number;
};
export const DEFAULT_TEST_BUDGETS: TestBudgets = {
	quantumCycles: 65536,
	bootCycles: 67_737_600,
	phaseCycles: 33_868_800,
	cleanupCycles: 33_868_800,
	caseTicks: 3000,
	caseCycles: 3_386_880_000,
};

type Phase = 'bind' | 'setup' | 'body' | 'teardown' | 'cancel';
type Wait =
	| { kind: 'ticks'; target: number }
	| { kind: 'input'; target: number }
	| { kind: 'boundary'; receipt: Table; deadline: number }
	| { kind: 'capture'; tick: number };

/** Policy over ordinary compiled phase coroutines; never interprets a test's return value. */
export class TestExecution {
	public active = true;
	public bootCycles = 0;
	public phaseCycles = 0;
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
	private readonly admission: ExecutionHook = (_domain, pc): boolean => {
		const cpu = this.target.runtime.machine.cpu;
		if (this.booting) {
			this.entered = cpu.activeThread === cpu.rootThread
				&& pc === this.program.entryCodeAddress;
			return this.entered;
		}
		return this.wait?.kind === 'boundary' && this.wait.receipt.getStringKey(this.reachedKey) === true;
	};

	public constructor(
		public readonly target: TestTarget,
		private readonly program: BuiltTestCartridge,
		private readonly results: ScenarioResultService,
		public readonly result: ScenarioTestResult,
		private readonly budgets: TestBudgets = DEFAULT_TEST_BUDGETS,
		private readonly captured?: (target: TestTarget, label: string) => void,
	) {
		const cpu = target.runtime.machine.cpu;
		this.reachedKey = cpu.stringPool.intern('reached');
		cpu.setExecutionHook(this.admission, executionDomainBit(0), executionDomainBit(0));
	}

	/** One bounded CPU grant or game grant. The host gets control between grants. */
	public advance(): void {
		const runtime = this.target.runtime;
		const cpu = runtime.machine.cpu;
		this.target.serviceBackend();
		this.fsm?.drain(runtime.frameScheduler.lastTickSequence);
		this.actioneffects?.drain(runtime.frameScheduler.lastTickSequence);
		if (runtime.machine.memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) !== 0) {
			const memory = runtime.machine.memory;
			this.stop(`Machine fault: domain ${memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_DOMAIN) | 0}, `
				+ `cause ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_CAUSE), 8)}, `
				+ `PC ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_EPC), 8)}, `
				+ `address ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS), 8)}.`);
			return;
		}
		if (this.booting) {
			const before = runtime.machine.scheduler.nowCycles;
			runtime.cpuExecution.runSuspendedUntilDepth(0, Math.min(this.budgets.quantumCycles, this.budgets.bootCycles - this.bootCycles), cpu.rootThread);
			this.bootCycles += runtime.machine.scheduler.nowCycles - before;
			if (this.entered) {
				this.booting = false;
				cpu.setExecutionHook(null, 0, 0);
				this.startTick = runtime.frameScheduler.lastTickSequence;
				const pool = cpu.stringPool;
				const suite = cpu.getGlobalByKey(pool.intern(buildModuleExportSlotName(this.program.suite.modulePath, []))) as Table;
				const execution = cpu.getGlobalByKey(pool.intern(buildModuleExportSlotName(TEST_EXECUTION_MODULE_PATH, []))) as Table;
				this.resume = execution.getStringKey(pool.intern('resume')) as Closure;
				this.closePhase = execution.getStringKey(pool.intern('cancel')) as Closure;
				this.beginCall(execution.getStringKey(pool.intern('bind')) as Closure, [suite, valueString(pool.intern(this.result.test.caseName))]);
			} else if (this.bootCycles >= this.budgets.bootCycles) this.stop('Module initialization exceeded its cycle budget');
			return;
		}
		if (this.cleanupStartCycles !== 0 && runtime.machine.scheduler.nowCycles - this.cleanupStartCycles >= this.budgets.cleanupCycles) {
			this.stop('Cleanup exceeded its cycle budget');
			return;
		}
		if (!this.cancelling && runtime.machine.scheduler.nowCycles >= this.budgets.caseCycles) {
			this.stop('Case exceeded its machine-cycle budget');
			return;
		}
		if (!this.cancelling && runtime.frameScheduler.lastTickSequence - this.startTick >= this.budgets.caseTicks) {
			this.stop('Case exceeded its logical-tick budget');
			return;
		}
		if (this.wait !== null) {
			this.advanceWait();
			return;
		}
		if (!this.callPending) {
			// A physical exception must return before a new external phase call.
			const exceptionDepth = cpu.readExceptionReturnFrameDepth();
			if (exceptionDepth !== -1) {
				runtime.cpuExecution.runSuspendedUntilDepth(exceptionDepth, this.budgets.quantumCycles, cpu.activeThread);
				return;
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
				return;
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
		} else if (this.phaseCycles >= this.budgets.phaseCycles) this.stop('Phase exceeded its cycle budget');
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
				runtime.machine.cpu.setExecutionHook(this.admission, ALL_EXECUTION_DOMAINS_MASK, ALL_EXECUTION_DOMAINS_MASK);
				break;
			case 'capture':
				this.results.requestCapture(this.result, tick, pool.toString(asStringId(values[2] as StringValue)));
				this.wait = { kind: 'capture', tick };
				break;
			default: this.stop(`Unsupported test operation '${operation}'`);
		}
	}

	private advanceWait(): void {
		const runtime = this.target.runtime;
		const wait = this.wait!;
		let ready: boolean;
		switch (wait.kind) {
			case 'ticks': ready = runtime.frameScheduler.lastTickSequence >= wait.target; break;
			case 'input': ready = this.target.input.samples >= wait.target; break;
			case 'boundary':
				ready = wait.receipt.getStringKey(this.reachedKey) === true || runtime.frameScheduler.lastTickSequence >= wait.deadline;
				if (ready) {
					runtime.machine.cpu.setExecutionHook(null, 0, 0);
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
		if (ready) this.wait = null;
		else this.target.advanceGame(this.budgets.quantumCycles);
	}

	private failure(thread: Thread, message: string): ScenarioRunFailure {
		const frames = buildLuaStackFrames(thread.frames.map((frame, index, frames) => {
			const domain = frame.executionImage.executionDomainId;
			const image = this.program.debugImages[domain + 1]!.image;
			return {
				executionDomainId: domain, toolingImage: image, functionAddress: frame.functionAddress,
				functionIndex: blua32FunctionIndexAtAddress(image.layout, frame.functionAddress),
				tracePc: index === frames.length - 1 ? frame.pc - INSTRUCTION_BYTES : frames[index + 1].callSitePc,
			};
		}), (domain, source, line, column, functionName) => {
			const path = this.program.debugImages[domain + 1]!.sourcePaths.get(source)!;
			const sourceDomain: ResourceDomain = domain === -1 ? -1 : (domain ^ this.result.test.resource.domain) as 0 | 1;
			return { kind: 'source', resource: { domain: sourceDomain, path }, workspacePath: path, line, column, functionName };
		});
		// Prefer the authored cartridge location over a BIOS assert/error implementation.
		const source = frames.find(frame => frame.kind === 'source' && frame.resource.domain === this.result.test.resource.domain);
		const location = source?.kind === 'source'
			? { resource: source.resource, line: source.line, column: source.column } : undefined;
		const stackTrace = frames.map(frame => frame.kind === 'source'
			? `${frame.workspacePath}:${frame.line}:${frame.column} (${frame.functionName})`
			: `${frame.functionName}@${frame.instructionAddress.toString(16)}`).join('\n');
		return { phase: this.booting ? 'initialize' : this.phase, message, stackTrace, location };
	}

	private complete(): void {
		this.fsm?.drain(this.target.runtime.frameScheduler.lastTickSequence);
		this.actioneffects?.drain(this.target.runtime.frameScheduler.lastTickSequence);
		this.active = false;
		this.target.input.reset();
		this.target.runtime.machine.cpu.setExecutionHook(null, 0, 0);
		if (this.cancelling) this.results.cancel(this.result, this.target.runtime.frameScheduler.lastTickSequence);
		else this.results.complete(this.result, this.target.runtime.frameScheduler.lastTickSequence);
	}

	private stop(message: string): void {
		// An uncooperative continuation is quarantined, not unwound to fake cleanup.
		this.results.recordFailure(this.result, this.failure(this.target.runtime.machine.cpu.activeThread, message));
		this.target.runtime.machine.cpu.setExecutionHook(null, 0, 0);
		this.complete();
	}

	public cancel(cooperative = true): void {
		if (cooperative && this.cancelling) return;
		this.cancelling = true;
		const runtime = this.target.runtime;
		const cpu = runtime.machine.cpu;
		if (cooperative && this.phase === 'teardown') return;
		this.target.input.reset();
		cpu.setExecutionHook(null, 0, 0);
		if (!cooperative || this.booting || this.callPending || cpu.readExceptionReturnFrameDepth() !== -1) {
			// There is no safe external call boundary: retain the continuation, never truncate it.
			this.results.recordFailure(this.result, { phase: 'cancel', message: 'Cleanup incomplete: cancelled outside a cooperative phase boundary.' });
			this.complete();
			return;
		}
		this.wait = null;
		const phase = this.phase;
		this.nextPhase('cancel');
		this.cleanupStartCycles = runtime.machine.scheduler.nowCycles;
		this.beginCall(this.closePhase, [valueString(cpu.stringPool.intern(phase))]);
	}
}
