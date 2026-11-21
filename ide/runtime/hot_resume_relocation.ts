import type { FunctionPrototype } from '../../machine/ts/machine/cpu/closure';
import { FrameField, type FrameExecutionTarget } from '../../machine/ts/machine/cpu/call_state';
import type { ExecutionImageRelocation } from '../../machine/ts/machine/cpu/execution_image';
import {
	blua32FunctionIndexAtAddress,
	type Blua32ImageLayout,
} from '../../toolchain/ts/rompack/blua32_image';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import {
	relocatedCallSitePc,
	relocatedContinuationPc,
	type Blua32ExecutionImageRevision,
} from '../../toolchain/ts/rompack/blua32_revision';

export type HotResumeRevision = {
	readonly previousImage: Blua32ImageLayout;
	readonly nextImage: Blua32ImageLayout;
	readonly revision: Blua32ExecutionImageRevision;
};

export type HotResumeRevisions = readonly [
	HotResumeRevision | null,
	HotResumeRevision | null,
	HotResumeRevision | null,
];

export type HotResumeRelocation = ExecutionImageRelocation & {
	readonly observations: Uint32Array;
};

const FRAME_CALL_SITE_WORDS = 2;
const FRAME_CALL_SITE_WRITE = 0;
const FRAME_CALL_SITE_PC = 1;

const EPC_WRITE = 0;
const EPC_WORD = 1;
const NMI_RETURN_EPC_WRITE = 2;
const NMI_RETURN_EPC_WORD = 3;
const LATCH_WORDS = 4;

export function buildHotResumeRelocation(
	cpu: CPU,
	revisions: HotResumeRevisions,
	frameCount: number,
): HotResumeRelocation {
	const latchBase = frameCount * FRAME_CALL_SITE_WORDS;
	const observations = new Uint32Array(latchBase + LATCH_WORDS);
	const frames = new Array<FrameExecutionTarget | null>(frameCount).fill(null);
	const closures = new Map<number, number>();
	const unmappedWords: string[] = [];
	let binding: FunctionPrototype | undefined;
	cpu.visitReachableExecutionRecords(closure => {
		binding = cpu.captureClosureBinding(closure, binding);
		const target = revisions[binding.executionDomainId + 1];
		if (target === null) return;
		const index = blua32FunctionIndexAtAddress(target.previousImage, binding.functionAddress);
		if (index === -1) return;
		const address = target.revision.functionAddresses[index];
		if (address === 0) {
			unmappedWords.push(`closure 0x${binding.functionAddress.toString(16)}`);
			return;
		}
		const newIndex = blua32FunctionIndexAtAddress(target.nextImage, address);
		if (target.nextImage.functions[newIndex].upvalues.length !== binding.recordUpvalueCount) {
			unmappedWords.push(`closure 0x${binding.functionAddress.toString(16)} captures`);
		}
		if (address !== binding.functionAddress) closures.set(closure, address);
	}, (thread, depth) => {
		if (thread === cpu.activeThread.address) return;
		for (let index = 0; index < depth; ++index) {
			const target = revisions[cpu.readThreadFrameExecutionDomain(thread, index) + 1];
			if (target !== null && blua32FunctionIndexAtAddress(target.previousImage, cpu.readThreadFrameWord(thread, index, FrameField.Function)) !== -1)
				unmappedWords.push(`inactive thread 0x${thread.toString(16)} frame ${index}`);
		}
	});

	for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
		const executionDomain = cpu.readFrameExecutionDomain(frameIndex);
		const target = revisions[executionDomain + 1];
		if (target === null) {
			continue;
		}
		const functionIndex = blua32FunctionIndexAtAddress(
			target.previousImage,
			cpu.readFrameFunctionAddress(frameIndex),
		);
		// An execution domain also runs RAM-compiled Lua. Only records owned by
		// the replaced linked image participate in its relocation.
		if (functionIndex === -1) continue;
		const functionAddress = target.revision.functionAddresses[functionIndex];
		const pc = relocatedContinuationPc(
			target.revision,
			target.previousImage,
			cpu.readFramePc(frameIndex),
		);
		if (functionAddress === 0 || pc < 0) {
			unmappedWords.push(`frame ${frameIndex} continuation 0x${cpu.readFramePc(frameIndex).toString(16)}`);
			continue;
		}
		frames[frameIndex] = { domain: executionDomain, functionAddress, pc };
	}

	for (let childFrameIndex = 1; childFrameIndex < frameCount; childFrameIndex += 1) {
		// External completion roots have no guest CALL in the frame below them.
		if (cpu.readFrameReturnsToCompletionLatch(childFrameIndex)) continue;
		const parent = frames[childFrameIndex - 1];
		if (parent === null) continue;
		const target = revisions[parent.domain + 1]!;
		const rawPc = cpu.readFrameCallSitePc(childFrameIndex);
		const pc = cpu.isExceptionFrame(childFrameIndex)
			? relocatedContinuationPc(target.revision, target.previousImage, rawPc)
			: relocatedCallSitePc(target.revision, target.previousImage, rawPc);
		if (pc < 0) {
			unmappedWords.push(`frame ${childFrameIndex} call site 0x${rawPc.toString(16)}`);
			continue;
		}
		const writeOffset = childFrameIndex * FRAME_CALL_SITE_WORDS;
		observations[writeOffset + FRAME_CALL_SITE_WRITE] = 1;
		observations[writeOffset + FRAME_CALL_SITE_PC] = pc;
	}

	let activeExceptionFrameIndex = -1;
	for (let frameIndex = frameCount - 1; frameIndex >= 0; frameIndex -= 1) {
		if (cpu.isExceptionFrame(frameIndex)) {
			activeExceptionFrameIndex = frameIndex;
			break;
		}
	}
	const epcOwnerFrameIndex = activeExceptionFrameIndex - 1;
	const epcOwner = epcOwnerFrameIndex < 0 ? null : frames[epcOwnerFrameIndex];
	if (epcOwner !== null) {
		const target = revisions[epcOwner.domain + 1]!;
		const pc = relocatedContinuationPc(target.revision, target.previousImage, cpu.readEpcWord());
		if (pc < 0) {
			unmappedWords.push(`exception EPC 0x${cpu.readEpcWord().toString(16)}`);
		} else {
			observations[latchBase + EPC_WRITE] = 1;
			observations[latchBase + EPC_WORD] = pc;
		}
	}

	if (activeExceptionFrameIndex >= 0
		&& cpu.isNonMaskableExceptionFrame(activeExceptionFrameIndex)) {
		let interruptedExceptionFrameIndex = -1;
		for (let frameIndex = activeExceptionFrameIndex - 1; frameIndex >= 0; frameIndex -= 1) {
			if (cpu.isExceptionFrame(frameIndex)) {
				interruptedExceptionFrameIndex = frameIndex;
				break;
			}
		}
		const nmiReturnEpcOwnerFrameIndex = interruptedExceptionFrameIndex - 1;
		const nmiOwner = nmiReturnEpcOwnerFrameIndex < 0 ? null : frames[nmiReturnEpcOwnerFrameIndex];
		if (nmiOwner !== null) {
			const target = revisions[nmiOwner.domain + 1]!;
			const pc = relocatedContinuationPc(target.revision, target.previousImage, cpu.readNmiReturnEpcWord());
			if (pc < 0) {
				unmappedWords.push(`NMI return EPC 0x${cpu.readNmiReturnEpcWord().toString(16)}`);
			} else {
				observations[latchBase + NMI_RETURN_EPC_WRITE] = 1;
				observations[latchBase + NMI_RETURN_EPC_WORD] = pc;
			}
		}
	}

	// lastPc/lastExecutionDomain describe a past fetch, not a continuation.
	// In particular, a completed debugger call has no retained frame to resume.
	// ROM replacement must not rewrite that history or require it to be resumable.

	if (unmappedWords.length > 0) {
		throw new Error(
			`Hot Resume could not map: ${unmappedWords.join('; ')}.`,
		);
	}
	return { closures, frames, observations };
}

export function applyHotResumeObservations(cpu: CPU, relocation: HotResumeRelocation): void {
	const { frames, observations } = relocation;
	const frameCount = frames.length;
	const latchBase = frameCount * FRAME_CALL_SITE_WORDS;
	for (let childFrameIndex = 1; childFrameIndex < frameCount; childFrameIndex += 1) {
		// External completion roots have no guest CALL in the frame below them.
		if (cpu.readFrameReturnsToCompletionLatch(childFrameIndex)) continue;
		const readOffset = childFrameIndex * FRAME_CALL_SITE_WORDS;
		if (observations[readOffset + FRAME_CALL_SITE_WRITE] !== 0) {
			cpu.writeFrameCallSitePc(
				childFrameIndex,
				observations[readOffset + FRAME_CALL_SITE_PC],
			);
		}
	}
	if (observations[latchBase + EPC_WRITE] !== 0) {
		cpu.writeEpcWord(observations[latchBase + EPC_WORD]);
	}
	if (observations[latchBase + NMI_RETURN_EPC_WRITE] !== 0) {
		cpu.writeNmiReturnEpcWord(observations[latchBase + NMI_RETURN_EPC_WORD]);
	}
}

export function applyHotResumeRelocation(cpu: CPU, relocation: HotResumeRelocation): void {
	for (let i = 0; i < relocation.frames.length; ++i) {
		const frame = relocation.frames[i];
		if (frame !== null) cpu.writeFrameExecution(i, frame.domain, frame.functionAddress, frame.pc);
	}
	applyHotResumeObservations(cpu, relocation);
}
