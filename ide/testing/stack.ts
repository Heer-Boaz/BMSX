import type { Thread } from '../../machine/ts/machine/cpu/thread';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import type { BuiltFixtureProgram } from './fixture_media';
import type { Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { buildLuaStackFrames, type RuntimeStackFrame, type RuntimeStackTraceFrame, type SourceStackTraceFrame } from '../runtime/stack_trace';

/** Compiled locations of one borrowed physical thread, captured before that thread can execute again. */
export class TestStack {
	public readonly physical: readonly RuntimeStackFrame[];
	public readonly frames: readonly RuntimeStackTraceFrame[];
	public readonly sources: ReadonlyMap<SourceStackTraceFrame, Blua32CompiledSource>;

	public constructor(public readonly thread: Thread, program: BuiltFixtureProgram,
		public readonly origin: 'failed-thread' | 'quarantined-cpu' | 'stopped-thread') {
		const physical: RuntimeStackFrame[] = [];
		for (let frame = thread.firstFrame!, index = 0; index < thread.frameDepth; ++index, frame = frame.next!) {
			const domain = frame.executionImage.executionDomainId, image = (domain === -1 ? program.sourceMedia.system : program.sourceMedia.cartridgeSlots[domain])!;
			const child = frame === thread.currentFrame ? null : frame.next;
			physical.push({ executionDomainId: domain, toolingImage: image, functionAddress: frame.functionAddress,
				functionIndex: blua32FunctionIndexAtAddress(image.layout, frame.functionAddress),
				tracePc: child !== null && !child.returnToCompletionLatch ? child.callSitePc
					: frame.pc - (origin === 'failed-thread' && child === null ? INSTRUCTION_BYTES : 0) });
		}
		this.physical = physical;
		const stack = buildLuaStackFrames(this.physical);
		this.frames = stack.frames;
		this.sources = stack.sources;
	}
}
