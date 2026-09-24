import type { Thread } from '../../machine/ts/machine/cpu/thread';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import type { BuiltTestCartridge, TestDebugSource } from '../../toolchain/ts/rompack/test_cartridge';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import type { ResourceDomain } from '../common/resource';
import { buildLuaStackFrames, type RuntimeStackFrame, type RuntimeStackTraceFrame } from '../runtime/stack_trace';

/** Compiled locations of one borrowed physical thread, captured before that thread can execute again. */
export class TestStack {
	public readonly physical: readonly RuntimeStackFrame[];
	public readonly frames: readonly RuntimeStackTraceFrame[];
	public readonly sources: ReadonlyMap<RuntimeStackTraceFrame, TestDebugSource>;

	public constructor(public readonly thread: Thread, program: BuiltTestCartridge, sourceDomain: ResourceDomain,
		public readonly origin: 'failed-thread' | 'quarantined-cpu' | 'stopped-thread') {
		this.physical = thread.frames.map((frame, index, frames) => {
			const domain = frame.executionImage.executionDomainId, image = program.debugImages[domain + 1]!.image;
			const child = frames[index + 1];
			return { executionDomainId: domain, toolingImage: image, functionAddress: frame.functionAddress,
				functionIndex: blua32FunctionIndexAtAddress(image.layout, frame.functionAddress),
				tracePc: child !== undefined && !child.returnToCompletionLatch ? child.callSitePc
					: frame.pc - (origin === 'failed-thread' && child === undefined ? INSTRUCTION_BYTES : 0) };
		});
		// buildLuaStackFrames adds frame identity to its callback result; retain source by location order.
		const sourceRecords: TestDebugSource[] = [];
		this.frames = buildLuaStackFrames(this.physical, (domain, module, line, column, functionName) => {
			const source = program.debugImages[domain + 1]!.sources.get(module)!;
			sourceRecords.push(source);
			const resourceDomain: ResourceDomain = domain === -1 ? -1 : (domain ^ sourceDomain) as 0 | 1;
			return { kind: 'source', resource: { domain: resourceDomain, path: source.displayPath },
				workspacePath: source.displayPath, line, column, functionName };
		});
		const sources = new Map<RuntimeStackTraceFrame, TestDebugSource>();
		let index = 0;
		for (const frame of this.frames) if (frame.kind === 'source') sources.set(frame, sourceRecords[index++]);
		this.sources = sources;
	}
}
