import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, CLOSURE_PROTOTYPE_ADDRESS, executionDomain as closureExecutionDomain, type FunctionPrototype } from '../../machine/ts/machine/cpu/closure';
import { FRAME_COMPLETION, FRAME_EXCEPTION, FRAME_WINDOW_MASK, FrameField, frameCaptureCount, frameExecutionBank, registerWindowBucket } from '../../machine/ts/machine/cpu/call_state';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import {
	blua32FunctionIndexAtAddress,
	type Blua32ImageLayout,
} from '../../toolchain/ts/rompack/blua32_image';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { visitRuntimeExecutionRecords } from './execution_records';
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

type FrameExecutionTarget = { domain: ExecutionDomainId; functionAddress: number; pc: number };

export type HotResumeRelocation = {
	readonly frames: ReadonlyArray<FrameExecutionTarget | null>;
	readonly closures: ReadonlyMap<number, number>;
	readonly observations: Uint32Array;
	readonly valueEnd: number;
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
	// A weak binding can be found again before the next sweep. The linker
	// can replace its code, but a live canonical record keeps its address.
	cpu.gc.visitObjectRecords(cpu, (owner, closure) => {
		const memory = owner.memory;
		const header = memory.readRamRecordWord(closure);
		const flags = header >>> (8 * CLOSURE_BINDING_FLAGS);
		if ((header & 0xff) !== ValueTag.Closure || (flags & CLOSURE_CANONICAL) === 0 || owner.gc.sweepGarbage(closure)) return;
		const target = revisions[closureExecutionDomain(flags) + 1];
		if (target === null) return;
		const record = memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
		const index = blua32FunctionIndexAtAddress(target.previousImage, record);
		if (index >= 0 && target.revision.functionAddresses[index] !== record)
			unmappedWords.push(`canonical function 0x${record.toString(16)} must retain its record address`);
	});
	let binding: FunctionPrototype | undefined;
	visitRuntimeExecutionRecords(cpu, closure => {
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
		let caller: HotResumeRevision | null = null;
		for (let index = 0; index < depth; ++index) {
			const flags = cpu.readThreadFrameWord(thread, index, FrameField.Flags);
			if (caller !== null && (flags & FRAME_COMPLETION) === 0) {
				const callSite = cpu.readThreadFrameWord(thread, index, FrameField.CallSite);
				if ((flags & FRAME_EXCEPTION) !== 0 || relocatedCallSitePc(caller.revision, caller.previousImage, callSite) !== callSite)
					unmappedWords.push(`inactive thread 0x${thread.toString(16)} frame ${index} call site 0x${callSite.toString(16)}`);
			}
			caller = null;
			const domain = frameExecutionBank(flags);
			const target = revisions[domain + 1];
			if (target === null) continue;
			const address = cpu.readThreadFrameWord(thread, index, FrameField.Function);
			const oldIndex = blua32FunctionIndexAtAddress(target.previousImage, address);
			if (oldIndex < 0) continue;
			const pc = cpu.readThreadFrameWord(thread, index, FrameField.Pc);
			// A suspended thread keeps its physical frame words and aliases.
			// Only an unchanged, proven continuation needs no relocation.
			if ((flags & FRAME_EXCEPTION) !== 0 || target.revision.functionAddresses[oldIndex] !== address
				|| relocatedContinuationPc(target.revision, target.previousImage, pc) !== pc) {
				unmappedWords.push(`inactive thread 0x${thread.toString(16)} frame ${index} continuation 0x${pc.toString(16)}`);
				continue;
			}
			const previous = target.previousImage.functions[oldIndex];
			const next = target.nextImage.functions[blua32FunctionIndexAtAddress(target.nextImage, address)];
			const width = cpu.readThreadFrameWord(thread, index, FrameField.StackCapacity) & FRAME_WINDOW_MASK;
			const closure = cpu.readThreadFrameWord(thread, index, FrameField.Closure);
			const captures = frameCaptureCount(cpu.memory, closure);
			if (next.numParams !== previous.numParams || next.isVararg !== previous.isVararg
				|| next.upvalues.length !== captures || Math.max(next.numParams, next.maxStack) > width
				|| (captures !== 0 && (closureExecutionDomain(cpu.memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)) !== domain
					|| cpu.memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS) !== address))) {
				unmappedWords.push(`inactive thread 0x${thread.toString(16)} frame ${index} argument, capture or register layout`);
				continue;
			}
			caller = target;
		}
	});

	const thread = cpu.activeThread;
	// Per live frame: earliest argument slot, existing end, admitted end.
	const windows = new Uint32Array(3 * frameCount);
	let valueEnd = 0;
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
		const base = cpu.readThreadFrameWord(thread.address, frameIndex, FrameField.StackBase) & FRAME_WINDOW_MASK;
		const firstArg = cpu.readThreadFrameWord(thread.address, frameIndex, FrameField.VarargBase) & FRAME_WINDOW_MASK;
		const capacity = cpu.readThreadFrameWord(thread.address, frameIndex, FrameField.StackCapacity) & FRAME_WINDOW_MASK;
		const index = frameIndex * 3;
		windows[index] = Math.min(base, firstArg);
		windows[index + 1] = windows[index + 2] = base + capacity;
		valueEnd = Math.max(valueEnd, base + capacity);
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
		const previous = target.previousImage.functions[functionIndex];
		const next = target.nextImage.functions[blua32FunctionIndexAtAddress(target.nextImage, functionAddress)];
		const captures = cpu.getFrameUpvalueCount(frameIndex);
		if (next.numParams !== previous.numParams || next.isVararg !== previous.isVararg || next.upvalues.length !== captures) {
			unmappedWords.push(`frame ${frameIndex} argument or capture layout`);
			continue;
		}
		if (captures !== 0) {
			const closure = cpu.readThreadFrameWord(thread.address, frameIndex, FrameField.Closure);
			const bindingFlags = cpu.memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS);
			const prototype = closures.get(closure) ?? cpu.memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
			if (closureExecutionDomain(bindingFlags) !== executionDomain || prototype !== functionAddress) {
				unmappedWords.push(`frame ${frameIndex} capture binding`);
				continue;
			}
		}
		const needed = Math.max(next.numParams, next.maxStack);
		if (needed > capacity) {
			const end = base + registerWindowBucket(needed);
			windows[index + 2] = end;
			valueEnd = Math.max(valueEnd, end);
		}
		frames[frameIndex] = { domain: executionDomain, functionAddress, pc };
	}
	for (let index = 0; index < windows.length; index += 3) {
		const oldEnd = windows[index + 1], newEnd = windows[index + 2];
		if (oldEnd === newEnd) continue;
		for (let other = 0; other < windows.length; other += 3) {
			if (index !== other && oldEnd < windows[other + 2] && windows[other] < newEnd) {
				unmappedWords.push(`frame ${index / 3} overlaps live frame ${other / 3}`);
				break;
			}
		}
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
	return { closures, frames, observations, valueEnd };
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
	for (const [closure, record] of relocation.closures)
		cpu.memory.writeRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS, record);
	for (let i = 0; i < relocation.frames.length; ++i) {
		const frame = relocation.frames[i];
		if (frame !== null) cpu.writeFrameExecution(i, frame.domain, frame.functionAddress, frame.pc);
	}
	applyHotResumeObservations(cpu, relocation);
}
