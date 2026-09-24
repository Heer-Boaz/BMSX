import { ThreadStatus, type Thread } from '../../machine/ts/machine/cpu/thread';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ResourceDomain } from '../common/resource';
import type { TestDebugger } from './debugger';
import { TestInspection } from './inspection';
import { TestStack } from './stack';

/** A borrow of a real debugger stop; the debugger retires it before any CPU grant or cleanup. */
export class TestStopInspection extends TestInspection {
	public readonly state;
	public constructor(runtime: Runtime, program: BuiltTestCartridge, sourceDomain: ResourceDomain,
		stop: ReturnType<TestDebugger['snapshot']>, thread: Thread, detached: () => void) {
		super(runtime, program, sourceDomain, detached);
		this.state = { ...stop, inspection: this.id, mode: 'stopped' as const, heap: 'stopped' as const,
			source: 'compiled-test-images' as const, canEvaluate: false, globals: this.globals,
			stack: thread.status === ThreadStatus.Dead ? { status: 'thread-closed' as const, thread: thread.hashId }
				: { status: 'available' as const, thread: thread.hashId,
					reference: this.addStack(new TestStack(thread, program, sourceDomain,
						thread.status === ThreadStatus.Failed ? 'failed-thread' : 'stopped-thread')) } };
	}
}
