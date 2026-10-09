import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuSuspendedRunResult } from '../../machine/ts/machine/runtime/cpu_executor';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { TEST_EXECUTION_MODULE_PATH, type BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';

const EXECUTION_SLOT = buildModuleExportSlotName(TEST_EXECUTION_MODULE_PATH, []);

/**
 * Physical admission and compiled fixture calls. The caller owns grants,
 * instrumentation, yielded operations and case/play policy; this owner never
 * creates a test result or chooses the phase after a guest return.
 */
export class GuestFixture {
	public initialized = false;
	public entryReached = false;
	public callPending = false;
	public lastCallCycles = 0;
	private returnThread!: Thread;
	private returnDepth = 0;
	private readonly suiteSlot: string;

	public constructor(public readonly runtime: Runtime, public readonly program: BuiltTestCartridge) {
		this.suiteSlot = buildModuleExportSlotName(program.suite.modulePath, []);
	}

	/** Composed into the target owner's hook, never installed over its debugger. */
	public observeInitialization(domain: ExecutionDomainId, pc: number): boolean {
		const cpu = this.runtime.machine.cpu;
		this.entryReached = domain === 0 && cpu.activeThread === cpu.rootThread && pc === this.program.entryCodeAddress;
		return this.entryReached;
	}

	public advanceInitialization(cycles: number): void {
		const cpu = this.runtime.machine.cpu;
		this.runtime.cpuExecution.runSuspendedUntilDepth(0, cycles, cpu.rootThread);
	}

	/** Null binds only the module's shared setup/teardown fixture, not a case body. */
	public bind(caseName: string | null): void {
		const cpu = this.runtime.machine.cpu, pool = cpu.stringPool;
		this.initialized = true;
		this.beginCall('bind', [cpu.getGlobalByKey(pool.intern(this.suiteSlot)), caseName === null ? null : valueString(pool.intern(caseName))]);
	}

	/** A physical exception returns first; it is never truncated to admit a host call. */
	public advance(args: readonly Value[], cycles: number): boolean {
		const runtime = this.runtime, cpu = runtime.machine.cpu;
		this.lastCallCycles = 0;
		if (!this.callPending) {
			const exceptionDepth = cpu.readExceptionReturnFrameDepth();
			if (exceptionDepth !== -1) {
				runtime.cpuExecution.runSuspendedUntilDepth(exceptionDepth, cycles, cpu.activeThread);
				return false;
			}
			this.beginCall('resume', args);
		}
		const before = runtime.machine.scheduler.nowCycles;
		const status = runtime.cpuExecution.runSuspendedUntilDepth(this.returnDepth, cycles, this.returnThread);
		this.lastCallCycles = runtime.machine.scheduler.nowCycles - before;
		if (status !== CpuSuspendedRunResult.Completed) return false;
		this.callPending = false;
		return true;
	}

	public cancelPhase(phase: string): void {
		this.beginCall('cancel', [valueString(this.runtime.machine.cpu.stringPool.intern(phase))]);
	}

	/** The compiled context retains recorder roots across history restore. No phase call or heap scan is needed. */
	public readContext(): Table {
		const cpu = this.runtime.machine.cpu, pool = cpu.stringPool;
		const execution = cpu.getGlobalByKey(pool.find(EXECUTION_SLOT)!) as Table;
		return execution.getStringKey(pool.find('context')!) as Table;
	}

	private beginCall(method: 'bind' | 'resume' | 'cancel', args: readonly Value[]): void {
		const cpu = this.runtime.machine.cpu, pool = cpu.stringPool;
		// Resolve the current guest module, not closures borrowed from an older heap.
		const execution = cpu.getGlobalByKey(pool.intern(EXECUTION_SLOT)) as Table;
		this.returnThread = cpu.activeThread;
		this.returnDepth = cpu.getFrameDepth();
		cpu.beginCompletionCall(execution.getStringKey(pool.intern(method)) as Closure, args);
		this.callPending = true;
	}
}
