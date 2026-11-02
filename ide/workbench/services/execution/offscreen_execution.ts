import { OffscreenMachine } from '../../../../hosts/common/offscreen_machine';
import { DISCONNECTED_INPUT } from '../../../../hosts/common/input/disconnected';
import type { Closure } from '../../../../machine/ts/machine/cpu/closure';
import type { Value } from '../../../../machine/ts/machine/cpu/value';
import { ALL_EXECUTION_DOMAINS_MASK, type ExecutionDomainId } from '../../../../machine/ts/spec/blua32/execution_domain';
import type { ExecutionMedia } from './source_media';

/** Bounded, independently scheduled execution. Subjects and guest readiness belong
 * to the contribution; machine lifetime, calls and backend service do not. */
export class OffscreenExecution {
	public readonly machine: OffscreenMachine<typeof DISCONNECTED_INPUT>;
	private closed = false;
	public constructor(public readonly media: ExecutionMedia) {
		this.machine = new OffscreenMachine(media.systemRom, media.cartridgeSlots, media.machineModel, DISCONNECTED_INPUT);
	}
	public get runtime() { return this.machine.runtime; }
	public async advanceUntil(reached: () => boolean): Promise<void> {
		await this.pump(reached, () => { this.machine.advanceGame(this.runtime.timing.cpuCyclesPerMillisecond * 8); }, 5000);
	}

	public async runUntil(reached: () => boolean, milliseconds = 5000): Promise<void> {
		const runtime = this.runtime, cpu = runtime.machine.cpu;
		cpu.setExecutionHook(() => reached(), ALL_EXECUTION_DOMAINS_MASK, ALL_EXECUTION_DOMAINS_MASK);
		try { await this.pump(reached, () => { this.machine.advanceGame(runtime.timing.cpuCyclesPerMillisecond * 8); }, milliseconds); }
		finally { cpu.setExecutionHook(null, 0, 0); }
	}

	public async call(domain: ExecutionDomainId, closure: Closure, args: readonly Value[]): Promise<readonly Value[]> {
		if (this.closed) throw new Error('Execution closed.');
		const runtime = this.runtime, cpu = runtime.machine.cpu, thread = cpu.activeThread, depth = thread.frames.length;
		cpu.beginCompletionClosureInExecutionDomain(domain, closure, args);
		await this.pump(() => !cpu.completionCallPending(), () => {
			runtime.cpuExecution.runSuspendedUntilDepth(depth, runtime.timing.cpuCyclesPerMillisecond * 8, thread);
		}, 5000);
		const values: Value[] = [];
		cpu.readCompletionValues(values);
		return values;
	}

	private async pump(reached: () => boolean, advance: () => void, milliseconds: number): Promise<void> {
		if (this.closed) throw new Error('Execution closed.');
		const runtime = this.runtime, end = runtime.machine.scheduler.nowCycles + milliseconds * runtime.timing.cpuCyclesPerMillisecond;
		while (!reached()) {
			if (this.closed) throw new Error('Execution closed.');
			const before = runtime.machine.scheduler.nowCycles;
			this.machine.serviceBackend(); advance(); this.machine.serviceBackend();
			if (!reached() && (runtime.machine.scheduler.nowCycles >= end || runtime.machine.scheduler.nowCycles === before))
				throw new Error('Guest execution did not reach the requested boundary.');
			await new Promise<void>(resolve => setTimeout(resolve, 0));
		}
	}
	public dispose(): void {
		this.closed = true;
		this.runtime.machine.cpu.setInstructionObserver(null);
		this.machine.dispose();
	}
}
