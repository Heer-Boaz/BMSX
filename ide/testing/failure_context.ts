import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { BuiltFixtureProgram } from './fixture_media';
import type { ScenarioRunFailure } from './scenario/result_service';
import { TestStack } from './stack';

/** A failure keeps its own phase thread and compiled stack, not the active/authoring CPU. */
export class TestFailureContext {
	public readonly stack: TestStack;
	public readonly failure: ScenarioRunFailure;

	public constructor(
		cpu: CPU,
		public readonly thread: number,
		public readonly origin: 'failed-thread' | 'quarantined-cpu',
		public readonly cycles: number,
		public readonly videoTick: number,
		program: BuiltFixtureProgram,
		phase: ScenarioRunFailure['phase'], message: string,
	) {
		this.stack = new TestStack(cpu, thread, program, origin);
		const source = this.stack.frames.find(frame => frame.kind === 'source' && frame.resource.contextId === program.sourceMedia.cartridgeSlots[0]!.sourceContextId);
		this.failure = { phase, message,
			location: source?.kind === 'source' ? { resource: source.resource, line: source.line, column: source.column } : undefined,
			stackTrace: this.stack.frames.map(frame => frame.kind === 'source'
				? `${frame.workspacePath}:${frame.line}:${frame.column} (${frame.functionName})`
				: `${frame.functionName}@${frame.instructionAddress.toString(16)}`).join('\n'),
		};
	}
}
