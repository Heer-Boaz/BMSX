import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { FrameField, FRAME_COMPLETION } from '../../machine/ts/machine/cpu/call_state';
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

	public constructor(cpu: CPU, public readonly thread: number, program: BuiltFixtureProgram,
		public readonly origin: 'failed-thread' | 'quarantined-cpu' | 'stopped-thread') {
		const physical: RuntimeStackFrame[] = [];
		for (let index = 0, depth = cpu.readThreadFrameDepth(thread); index < depth; ++index) {
			const domain = cpu.readThreadFrameExecutionDomain(thread, index), image = (domain === -1 ? program.sourceMedia.system : program.sourceMedia.cartridgeSlots[domain])!;
			const functionAddress = cpu.readThreadFrameWord(thread, index, FrameField.Function);
			const hasChild = index + 1 < depth;
			physical.push({ executionDomainId: domain, toolingImage: image, functionAddress,
				functionIndex: blua32FunctionIndexAtAddress(image.layout, functionAddress),
				tracePc: hasChild && (cpu.readThreadFrameWord(thread, index + 1, FrameField.Flags) & FRAME_COMPLETION) === 0
					? cpu.readThreadFrameWord(thread, index + 1, FrameField.CallSite)
					: cpu.readThreadFrameWord(thread, index, FrameField.Pc) - (origin === 'failed-thread' && !hasChild ? INSTRUCTION_BYTES : 0) });
		}
		this.physical = physical;
		const stack = buildLuaStackFrames(this.physical);
		this.frames = stack.frames;
		this.sources = stack.sources;
	}
}
