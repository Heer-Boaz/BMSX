import type { Runtime } from '../../machine/ts/machine/runtime/runtime';

import { asClosure, valueNil, valueString, type Value, valuePayload } from '../../machine/ts/machine/cpu/value';
import { CpuSuspendedRunResult } from '../../machine/ts/machine/runtime/cpu_executor';
import type { FrameState } from '../../machine/ts/machine/runtime/frame/state';
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
	private returnThread!: number;
	private returnDepth = 0;
	private readonly suiteSlot: string;
	private readonly stoppedGrant: FrameState = {
		updateExecuted: false, cycleBudgetRemaining: 0, cycleBudgetGranted: 0,
		cycleCarryGranted: 0, activeCpuUsedCycles: 0, deferredAllocationCycles: 0,
	};

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
		if (this.runtime.machine.scheduler.acceptedCpuCycles !== 0) return;
		if (this.runtime.machine.systemController.cpuHeld()) {
			this.advanceHeldCpu(cycles);
			return;
		}
		const cpu = this.runtime.machine.cpu;
		this.runtime.cpuExecution.runSuspendedUntilDepth(0, cycles, cpu.rootThread.address);
	}

	/** Null binds only the module's shared setup/teardown fixture, not a case body. */
	public bind(caseName: string | null): void {
		if (!this.runtime.admitExternalCpuMutation()) throw new Error('Guest fixture requires a settled CPU and device frontier.');
		const cpu = this.runtime.machine.cpu, pool = cpu.stringPool;
		this.initialized = true;
		this.beginCall('bind', [cpu.getGlobalByKey(pool.intern(this.suiteSlot)), caseName === null ? valueNil() : valueString(pool.intern(caseName))]);
	}

	/** A physical exception returns first; it is never truncated to admit a host call. */
	public advance(args: readonly Value[], cycles: number): boolean {
		const runtime = this.runtime, cpu = runtime.machine.cpu;
		this.lastCallCycles = 0;
		if (runtime.machine.scheduler.acceptedCpuCycles !== 0) return false;
		const before = runtime.machine.scheduler.nowCycles;
		if (runtime.machine.systemController.cpuHeld()) {
			this.advanceHeldCpu(cycles);
			this.lastCallCycles = runtime.machine.scheduler.nowCycles - before;
			return false;
		}
		if (!this.callPending) {
			const exceptionDepth = cpu.readExceptionReturnFrameDepth();
			if (exceptionDepth !== -1) {
				runtime.cpuExecution.runSuspendedUntilDepth(exceptionDepth, cycles, cpu.activeThread.address);
				this.lastCallCycles = runtime.machine.scheduler.nowCycles - before;
				return false;
			}
			if (!runtime.admitExternalCpuMutation()) return false;
			this.beginCall('resume', args);
		}
		const status = runtime.cpuExecution.runSuspendedUntilDepth(this.returnDepth, cycles, this.returnThread);
		this.lastCallCycles = runtime.machine.scheduler.nowCycles - before;
		if (status !== CpuSuspendedRunResult.Completed) return false;
		this.callPending = false;
		return true;
	}

	/** Quiescing devices need time; a stopped grant never admits a fixture call or runs guest instructions. */
	private advanceHeldCpu(cycles: number): void {
		this.stoppedGrant.cycleBudgetRemaining = cycles;
		this.stoppedGrant.cycleBudgetGranted = cycles;
		this.runtime.cpuExecution.runStoppedCpu(this.stoppedGrant);
	}

	public cancelPhase(phase: string): void {
		if (!this.runtime.admitExternalCpuMutation()) throw new Error('Guest fixture requires a settled CPU and device frontier.');
		this.beginCall('cancel', [valueString(this.runtime.machine.cpu.stringPool.intern(phase))]);
	}

	/** The compiled context retains recorder roots across history restore. No phase call or heap scan is needed. */
	public readContext(): number {
		const cpu = this.runtime.machine.cpu, pool = cpu.stringPool;
		const execution = valuePayload(cpu.getGlobalByKey(pool.find(EXECUTION_SLOT)!));
		return valuePayload(cpu.gc.tables.getStringKey(execution, pool.find('context')!));
	}

	private beginCall(method: 'bind' | 'resume' | 'cancel', args: readonly Value[]): void {
		const cpu = this.runtime.machine.cpu, pool = cpu.stringPool;
		// Resolve the current guest module, not closures borrowed from an older heap.
		const execution = valuePayload(cpu.getGlobalByKey(pool.intern(EXECUTION_SLOT)));
		this.returnThread = cpu.activeThread.address;
		this.returnDepth = cpu.getFrameDepth();
		cpu.beginCompletionCall(asClosure(cpu.gc.tables.getStringKey(execution, pool.intern(method)), cpu.gc), args);
		this.callPending = true;
	}
}
