import {
	blua32FunctionIndexAtAddress,
	type Blua32ImageLayout,
} from '../../toolchain/ts/rompack/blua32_image';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import {
	relocatedCallSitePc,
	relocatedContinuationPc,
	relocatedInstructionPc,
	type Blua32ExecutionImageRevision,
} from '../../toolchain/ts/rompack/blua32_revision';

export type HotResumeRevision = {
	readonly previousImage: Blua32ImageLayout;
	readonly freshImage: Blua32ImageLayout;
	readonly revision: Blua32ExecutionImageRevision;
};

export type HotResumeRevisions = readonly [
	HotResumeRevision | null,
	HotResumeRevision | null,
	HotResumeRevision | null,
];

const FRAME_EXECUTION_WORDS = 3;
const FRAME_EXECUTION_DOMAIN = 0;
const FRAME_EXECUTION_FUNCTION = 1;
const FRAME_EXECUTION_PC = 2;

const FRAME_CALL_SITE_WORDS = 2;
const FRAME_CALL_SITE_WRITE = 0;
const FRAME_CALL_SITE_PC = 1;

const EPC_WRITE = 0;
const EPC_WORD = 1;
const NMI_RETURN_EPC_WRITE = 2;
const NMI_RETURN_EPC_WORD = 3;
const LAST_PC_WRITE = 4;
const LAST_PC_WORD = 5;
const LATCH_WORDS = 6;

export function buildHotResumeRelocation(
	cpu: CPU,
	revisions: HotResumeRevisions,
	frameCount: number,
): Uint32Array {
	const frameCallSiteBase = frameCount * FRAME_EXECUTION_WORDS;
	const latchBase = frameCallSiteBase + frameCount * FRAME_CALL_SITE_WORDS;
	const relocation = new Uint32Array(latchBase + LATCH_WORDS);
	let unmappedCount = 0;

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
		const functionAddress = target.revision.functionAddresses[functionIndex];
		const pc = relocatedContinuationPc(
			target.revision,
			target.previousImage,
			cpu.readFramePc(frameIndex),
		);
		if (functionAddress === 0 || pc < 0) {
			unmappedCount += 1;
			continue;
		}
		const writeOffset = frameIndex * FRAME_EXECUTION_WORDS;
		relocation[writeOffset + FRAME_EXECUTION_DOMAIN]
			= executionDomain + 2;
		relocation[writeOffset + FRAME_EXECUTION_FUNCTION] = functionAddress;
		relocation[writeOffset + FRAME_EXECUTION_PC] = pc;
	}

	for (let childFrameIndex = 1; childFrameIndex < frameCount; childFrameIndex += 1) {
		const parentExecutionDomain = cpu.readFrameExecutionDomain(childFrameIndex - 1);
		const target = revisions[parentExecutionDomain + 1];
		if (target === null) {
			continue;
		}
		const rawPc = cpu.readFrameCallSitePc(childFrameIndex);
		const pc = cpu.isExceptionFrame(childFrameIndex)
			? relocatedContinuationPc(target.revision, target.previousImage, rawPc)
			: relocatedCallSitePc(target.revision, target.previousImage, rawPc);
		if (pc < 0) {
			unmappedCount += 1;
			continue;
		}
		const writeOffset = frameCallSiteBase + childFrameIndex * FRAME_CALL_SITE_WORDS;
		relocation[writeOffset + FRAME_CALL_SITE_WRITE] = 1;
		relocation[writeOffset + FRAME_CALL_SITE_PC] = pc;
	}

	let activeExceptionFrameIndex = -1;
	for (let frameIndex = frameCount - 1; frameIndex >= 0; frameIndex -= 1) {
		if (cpu.isExceptionFrame(frameIndex)) {
			activeExceptionFrameIndex = frameIndex;
			break;
		}
	}
	const epcOwnerFrameIndex = activeExceptionFrameIndex - 1;
	if (epcOwnerFrameIndex >= 0) {
		const executionDomain = cpu.readFrameExecutionDomain(epcOwnerFrameIndex);
		const target = revisions[executionDomain + 1];
		if (target !== null) {
			const pc = relocatedContinuationPc(
				target.revision,
				target.previousImage,
				cpu.readEpcWord(),
			);
			if (pc < 0) {
				unmappedCount += 1;
			} else {
				relocation[latchBase + EPC_WRITE] = 1;
				relocation[latchBase + EPC_WORD] = pc;
			}
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
		if (nmiReturnEpcOwnerFrameIndex >= 0) {
			const executionDomain = cpu.readFrameExecutionDomain(nmiReturnEpcOwnerFrameIndex);
			const target = revisions[executionDomain + 1];
			if (target !== null) {
				const pc = relocatedContinuationPc(
					target.revision,
					target.previousImage,
					cpu.readNmiReturnEpcWord(),
				);
				if (pc < 0) {
					unmappedCount += 1;
				} else {
					relocation[latchBase + NMI_RETURN_EPC_WRITE] = 1;
					relocation[latchBase + NMI_RETURN_EPC_WORD] = pc;
				}
			}
		}
	}

	const lastPcTarget = revisions[cpu.readLastExecutionDomain() + 1];
	if (lastPcTarget !== null) {
		const pc = relocatedInstructionPc(
			lastPcTarget.revision,
			lastPcTarget.previousImage,
			lastPcTarget.freshImage,
			cpu.lastPc,
		);
		if (pc < 0) {
			unmappedCount += 1;
		} else {
			relocation[latchBase + LAST_PC_WRITE] = 1;
			relocation[latchBase + LAST_PC_WORD] = pc;
		}
	}

	if (unmappedCount > 0) {
		throw new Error(
			`Hot Resume could not map ${unmappedCount} execution word(s) to the rebuilt program.`,
		);
	}
	return relocation;
}

export function applyHotResumeRelocation(cpu: CPU, relocation: Uint32Array): void {
	const frameCount = (relocation.length - LATCH_WORDS)
		/ (FRAME_EXECUTION_WORDS + FRAME_CALL_SITE_WORDS);
	const frameCallSiteBase = frameCount * FRAME_EXECUTION_WORDS;
	const latchBase = frameCallSiteBase + frameCount * FRAME_CALL_SITE_WORDS;
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
		const readOffset = frameIndex * FRAME_EXECUTION_WORDS;
		const domainWord = relocation[readOffset + FRAME_EXECUTION_DOMAIN];
		switch (domainWord) {
			case 1:
				cpu.writeFrameExecution(
					frameIndex,
					-1,
					relocation[readOffset + FRAME_EXECUTION_FUNCTION],
					relocation[readOffset + FRAME_EXECUTION_PC],
				);
				break;
			case 2:
				cpu.writeFrameExecution(
					frameIndex,
					0,
					relocation[readOffset + FRAME_EXECUTION_FUNCTION],
					relocation[readOffset + FRAME_EXECUTION_PC],
				);
				break;
			case 3:
				cpu.writeFrameExecution(
					frameIndex,
					1,
					relocation[readOffset + FRAME_EXECUTION_FUNCTION],
					relocation[readOffset + FRAME_EXECUTION_PC],
				);
				break;
		}
	}

	for (let childFrameIndex = 1; childFrameIndex < frameCount; childFrameIndex += 1) {
		const readOffset = frameCallSiteBase + childFrameIndex * FRAME_CALL_SITE_WORDS;
		if (relocation[readOffset + FRAME_CALL_SITE_WRITE] !== 0) {
			cpu.writeFrameCallSitePc(
				childFrameIndex,
				relocation[readOffset + FRAME_CALL_SITE_PC],
			);
		}
	}
	if (relocation[latchBase + EPC_WRITE] !== 0) {
		cpu.writeEpcWord(relocation[latchBase + EPC_WORD]);
	}
	if (relocation[latchBase + NMI_RETURN_EPC_WRITE] !== 0) {
		cpu.writeNmiReturnEpcWord(relocation[latchBase + NMI_RETURN_EPC_WORD]);
	}
	if (relocation[latchBase + LAST_PC_WRITE] !== 0) {
		cpu.lastPc = relocation[latchBase + LAST_PC_WORD];
	}
}
