import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type { BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ResourceDomain } from '../common/resource';
import type { ScenarioRunFailure } from './scenario/result_service';
import { TestStack } from './stack';

/** A failure keeps its own phase thread and compiled stack, not the active/authoring CPU. */
export class TestFailureContext {
	public readonly stack: TestStack;
	public readonly failure: ScenarioRunFailure;

	public constructor(
		public readonly thread: Thread,
		public readonly origin: 'failed-thread' | 'quarantined-cpu',
		public readonly cycles: number,
		public readonly videoTick: number,
		program: BuiltTestCartridge, sourceDomain: ResourceDomain,
		phase: ScenarioRunFailure['phase'], message: string,
	) {
		this.stack = new TestStack(thread, program, sourceDomain, origin);
		const source = this.stack.frames.find(frame => frame.kind === 'source' && frame.resource.domain === sourceDomain);
		this.failure = { phase, message,
			location: source?.kind === 'source' ? { resource: source.resource, line: source.line, column: source.column } : undefined,
			stackTrace: this.stack.frames.map(frame => frame.kind === 'source'
				? `${frame.workspacePath}:${frame.line}:${frame.column} (${frame.functionName})`
				: `${frame.functionName}@${frame.instructionAddress.toString(16)}`).join('\n'),
		};
	}
}
