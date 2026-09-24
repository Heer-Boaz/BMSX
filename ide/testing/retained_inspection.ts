import { ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { TestFailureContext } from './failure_context';
import type { ScenarioTestResult } from './scenario/result_service';
import { TestInspection } from './inspection';

/** Read-only case-end attachment. Failed threads are not executable debugger stops. */
export class TestTargetInspection extends TestInspection {
	public readonly state;
	public constructor(target: string, runtime: Runtime, program: BuiltTestCartridge, result: ScenarioTestResult,
		contexts: readonly TestFailureContext[], detached: () => void) {
		super(runtime, program, result.test.resource.domain, detached);
		this.state = { inspection: this.id, target, role: 'retained-test' as const, mode: 'post-mortem' as const,
			heap: 'retained-at-case-end' as const, source: 'compiled-test-images' as const,
			canResume: false, canStep: false, canEvaluate: false,
			cycles: runtime.machine.scheduler.nowCycles, videoTick: runtime.frameScheduler.lastTickSequence, globals: this.globals,
			failures: result.failures.map((failure, index) => {
				const context = contexts.find(entry => entry.failure === failure);
				if (context === undefined) return { index, phase: failure.phase, message: failure.message, status: 'no-retained-guest-thread' as const };
				if (context.thread.status === ThreadStatus.Dead) return { index, phase: failure.phase, message: failure.message, status: 'thread-closed' as const };
				return { index, phase: failure.phase, message: failure.message, status: 'available' as const,
					reference: this.addStack(context.stack), origin: context.origin, cycles: context.cycles, videoTick: context.videoTick };
			}),
		};
	}
}
