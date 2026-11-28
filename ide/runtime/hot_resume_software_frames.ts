import { FRAME_WINDOW_MASK, FrameField } from '../../machine/ts/machine/cpu/call_state';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';
import { blua32FunctionIndexAtAddress, blua32FunctionIndexAtPc } from '../../toolchain/ts/rompack/blua32_image';
import { relocatedContinuationPc } from '../../toolchain/ts/rompack/blua32_revision';
import { blua32SlotLiveAtPc, type Blua32SoftwareFrameDebug } from '../../toolchain/ts/rompack/blua32_symbols';
import type { HotResumeRevision } from './hot_resume_relocation';

function linkSlotAtWord(frame: Blua32SoftwareFrameDebug, word: number): number {
	let slot = 0;
	for (const move of frame.linkSlots) {
		if (move.wordOffset > word) break;
		slot = move.slot;
	}
	return slot;
}

/**
 * Plan only the integer words the compiler proves to be live code addresses.
 * A logical activation borrows physical slots; it has no Frame record.
 */
export function planSoftwareCodeWords(cpu: CPU, target: HotResumeRevision, thread: number, frameAddress: number,
	physicalFunction: number, oldPc: number, nextPc: number, words: Map<number, number>): boolean {
	const { memory } = cpu;
	const [oldFrames, newFrames] = target.revision.softwareFrames;
	const previous = target.previousImage, next = target.nextImage;
	let oldFunction = blua32FunctionIndexAtPc(previous, oldPc);
	if (oldFunction < 0) return false;
	let newFunction = blua32FunctionIndexAtPc(next, nextPc);
	if (newFunction < 0) return false;
	if (oldFrames[oldFunction] === undefined && newFrames[newFunction] === undefined && oldFunction === physicalFunction)
		return target.revision.functionAddresses[oldFunction] === next.functions[newFunction].address;
	let base = memory.readRamRecordWord(frameAddress + FrameField.RegisterBase) & FRAME_WINDOW_MASK;
	const width = memory.readRamRecordWord(frameAddress + FrameField.StackCapacity) & FRAME_WINDOW_MASK;
	const stackBase = memory.readRamRecordWord(frameAddress + FrameField.StackBase) & FRAME_WINDOW_MASK;
	const stackBlock = memory.readRamRecordWord(thread + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
	const stackCapacity = memory.readRamRecordWord(thread + ThreadField.StackCapacity);
	let activePc = true;
	let needsRetainedWindow = false;
	for (;;) {
		if (newFunction < 0 || target.revision.functionAddresses[oldFunction] !== next.functions[newFunction].address) return false;
		const oldFrame = oldFrames[oldFunction], newFrame = newFrames[newFunction];
		const oldWord = (oldPc - previous.functions[oldFunction].codeAddress) / INSTRUCTION_BYTES;
		const newWord = (nextPc - next.functions[newFunction].codeAddress) / INSTRUCTION_BYTES;
		if (activePc && oldFrame !== undefined) {
			// The outgoing basis remains selected from the jump through
			// result adaptation and the final restoring instruction.
			const call = oldFrame.calls.find(call => oldWord >= call.wordOffset && oldWord < call.endWordOffset);
			if (call !== undefined) {
				const entering = oldWord < call.continuationWordOffset;
				const fresh = newFrame?.calls.find(c => newWord >= c.wordOffset && newWord < c.endWordOffset
					&& (newWord < c.continuationWordOffset) === entering);
				if (fresh === undefined || fresh.baseDelta !== call.baseDelta) return false;
				base -= call.baseDelta;
				needsRetainedWindow = true;
			}
		}
		if (base < 0 || ((needsRetainedWindow || oldFrame?.entry === true)
			&& base + next.functions[newFunction].maxStack > width)) return false;
		let liveTargets = 0;
		if (oldFrame !== undefined) for (const call of oldFrame.calls) {
			if (!blua32SlotLiveAtPc(call.targetLiveWordRanges, previous.functions[oldFunction].codeAddress, oldPc)) continue;
			++liveTargets;
			const fresh = newFrame?.calls.find(c => c.baseDelta === call.baseDelta
				&& blua32SlotLiveAtPc(c.targetLiveWordRanges, next.functions[newFunction].codeAddress, nextPc));
			if (fresh === undefined || base + call.baseDelta >= width) return false;
			const slot = stackBase + base + call.baseDelta;
			if (memory.readRamRecordByte(stackBlock + stackCapacity * 4 + slot) !== ValueTag.Integer) return false;
			const address = stackBlock + slot * 4;
			const oldTarget = memory.readRamRecordWord(address);
			const callee = call.targetFunctions.find(index => previous.functions[index].codeAddress === oldTarget);
			if (callee === undefined) return false;
			const replacement = blua32FunctionIndexAtAddress(next, target.revision.functionAddresses[callee]);
			if (!fresh.targetFunctions.includes(replacement)) return false;
			const newTarget = next.functions[replacement].codeAddress;
			if (newTarget !== oldTarget) words.set(address, newTarget);
		}
		if (newFrame !== undefined) for (const call of newFrame.calls)
			if (blua32SlotLiveAtPc(call.targetLiveWordRanges, next.functions[newFunction].codeAddress, nextPc)) --liveTargets;
		if (liveTargets !== 0) return false;
		if (oldFrame?.entry !== true)
			return newFrame?.entry !== true && (physicalFunction < 0 || oldFunction === physicalFunction);
		if (newFrame?.entry !== true) return false;

		const link = linkSlotAtWord(oldFrame, oldWord);
		if (link !== linkSlotAtWord(newFrame, newWord) || base + link >= width) return false;
		const slot = stackBase + base + link;
		if (memory.readRamRecordByte(stackBlock + stackCapacity * 4 + slot) !== ValueTag.Integer) return false;
		const address = stackBlock + slot * 4;
		const continuation = memory.readRamRecordWord(address);
		const owner = blua32FunctionIndexAtPc(previous, continuation);
		if (owner < 0) return false;
		const word = (continuation - previous.functions[owner].codeAddress) / INSTRUCTION_BYTES;
		const call = oldFrames[owner]?.calls.find(call => call.continuationWordOffset === word
			&& call.targetFunctions.includes(oldFunction));
		if (call === undefined) return false;
		const nextContinuation = relocatedContinuationPc(target.revision, previous, continuation);
		const nextOwner = blua32FunctionIndexAtPc(next, nextContinuation);
		if (nextOwner < 0) return false;
		const nextWord = (nextContinuation - next.functions[nextOwner].codeAddress) / INSTRUCTION_BYTES;
		const nextCall = newFrames[nextOwner]?.calls.find(call => call.continuationWordOffset === nextWord
			&& call.targetFunctions.includes(newFunction));
		if (nextCall === undefined || nextCall.baseDelta !== call.baseDelta) return false;
		if (nextContinuation !== continuation) words.set(address, nextContinuation);
		base -= call.baseDelta;
		needsRetainedWindow = true;
		oldPc = continuation;
		nextPc = nextContinuation;
		activePc = false;
		oldFunction = owner;
		newFunction = nextOwner;
	}
}
