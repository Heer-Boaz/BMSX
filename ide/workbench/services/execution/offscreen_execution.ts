import { OffscreenMachine } from '../../../../hosts/common/offscreen_machine';
import type { Closure } from '../../../../machine/ts/machine/cpu/closure';
import type { Value } from '../../../../machine/ts/machine/cpu/value';
import { ALL_EXECUTION_DOMAINS_MASK, type ExecutionDomainId } from '../../../../machine/ts/spec/blua32/execution_domain';
import { captureActiveRuntimeFault, RuntimeGuestFault } from '../../../runtime/fault_state';
import { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { TestInput } from '../../../testing/input';
import { PlayFixture } from '../../../testing/play_fixture';
import { PlayEvidence } from '../play/evidence';
import type { ExecutionMedia } from './source_media';

/** Bounded, independently scheduled execution. Subjects and guest readiness belong
 * to the contribution; machine lifetime, fixture admission and backend service do not. */
export class OffscreenExecution {
	public readonly machine: OffscreenMachine<TestInput>;
	private readonly guest: SuspendedGuestSession;
	private readonly fixture: PlayFixture | undefined;
	private readonly evidence: PlayEvidence | undefined;
	private closing = false;
	private failed = false;
	private pending: Promise<void> = Promise.resolve();
	private closeOperation: Promise<void> | undefined;
	public constructor(public readonly media: ExecutionMedia) {
		this.machine = new OffscreenMachine(media.systemRom, media.cartridgeSlots, media.machineModel, new TestInput());
		this.guest = new SuspendedGuestSession(this.runtime);
		if (media.fixture !== undefined) {
			this.evidence = new PlayEvidence(this.runtime, () => this.fixture!.readContext());
			this.fixture = new PlayFixture(this.machine, this.machine.input, media.fixture, this.evidence);
		}
	}
	public get runtime() { return this.machine.runtime; }

	/** Runs only the shared integration setup, never a test case. */
	public async initializeFixture() {
		await this.execute(() => this.drainFixture());
		return this.fixture!.readContext();
	}

	public advanceUntil(reached: () => boolean): Promise<void> {
		return this.execute(() => this.pump(reached, () => { this.machine.advanceGame(this.runtime.timing.cpuCyclesPerMillisecond * 8); }, 5000));
	}

	public runUntil(reached: () => boolean, milliseconds = 5000): Promise<void> {
		return this.execute(async () => {
			const runtime = this.runtime, cpu = runtime.machine.cpu;
			cpu.setExecutionHook(() => reached(), ALL_EXECUTION_DOMAINS_MASK, ALL_EXECUTION_DOMAINS_MASK);
			try { await this.pump(reached, () => { this.machine.advanceGame(runtime.timing.cpuCyclesPerMillisecond * 8); }, milliseconds); }
			finally { cpu.setExecutionHook(null, 0, 0); }
		});
	}

	public async call(domain: ExecutionDomainId, closure: Closure, args: readonly Value[]): Promise<readonly Value[]> {
		const values: Value[] = [];
		await this.execute(async () => {
			const runtime = this.runtime, cpu = runtime.machine.cpu, thread = cpu.activeThread, depth = thread.frames.length;
			cpu.beginCompletionClosureInExecutionDomain(domain, closure, args);
			await this.pump(() => !cpu.completionCallPending(), () => {
				runtime.cpuExecution.runSuspendedUntilDepth(depth, runtime.timing.cpuCyclesPerMillisecond * 8, thread);
			}, 5000);
			cpu.readCompletionValues(values);
		});
		return values;
	}

	/** Retirement joins the admitted operation before cleanup can use the CPU. */
	private execute(operation: () => Promise<void>): Promise<void> {
		if (this.closing) return Promise.reject(new Error('Execution closed.'));
		const completion = Promise.withResolvers<void>();
		this.pending = completion.promise;
		const running = operation();
		void running.then(completion.resolve, () => { this.failed = true; completion.resolve(); });
		return running;
	}

	private async pump(reached: () => boolean, advance: () => void, milliseconds: number): Promise<void> {
		const runtime = this.runtime, end = runtime.machine.scheduler.nowCycles + milliseconds * runtime.timing.cpuCyclesPerMillisecond;
		let progressed = true;
		for (;;) {
			const fault = captureActiveRuntimeFault(this.media, runtime, this.guest);
			if (fault !== undefined) throw fault;
			if (reached()) return;
			const before = runtime.machine.scheduler.nowCycles;
			if (!progressed || before >= end) throw new Error('Guest execution did not reach the requested boundary.');
			this.machine.serviceBackend(); advance(); this.machine.serviceBackend();
			progressed = runtime.machine.scheduler.nowCycles !== before;
			await new Promise<void>(resolve => setTimeout(resolve, 0));
		}
	}

	private async drainFixture(): Promise<void> {
		const fixture = this.fixture!;
		while (fixture.admitting) {
			for (let grant = 0; grant < 16 && fixture.admitting; grant++) {
				const fault = captureActiveRuntimeFault(this.media, this.runtime, this.guest);
				if (fault !== undefined) throw fault;
				if (this.closing && fixture.state !== 'cleanup') fixture.stop();
				fixture.advance(); this.evidence!.drain();
			}
			await new Promise<void>(resolve => setTimeout(resolve, 0));
		}
		const failure = fixture.failures[0];
		if (failure !== undefined) {
			const { location, message, stackTrace } = failure.failure;
			throw new RuntimeGuestFault({ message, resource: location?.resource, line: location?.line ?? 0, column: location?.column ?? 0,
				details: { luaStack: failure.stack.frames, sources: failure.stack.sources } }, stackTrace!);
		}
	}

	public dispose(): Promise<void> {
		if (this.closeOperation !== undefined) return this.closeOperation;
		this.closing = true;
		this.machine.frameOutput.dispose();
		return this.closeOperation = this.close();
	}
	private async close(): Promise<void> {
		await this.pending;
		this.runtime.machine.cpu.setInstructionObserver(null);
		try {
			if (this.fixture !== undefined && !this.failed) { this.fixture.stop(); await this.drainFixture(); }
		} finally {
			this.evidence?.dispose();
			if (this.fixture === undefined) this.machine.dispose(); else this.fixture.dispose();
		}
	}
}
