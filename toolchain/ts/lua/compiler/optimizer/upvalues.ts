import { OpCode } from '../../../../../machine/ts/spec/blua32/opcode';
import type { UpvalueDesc } from '../program';
import type { Instruction } from './index';

export function compactUnusedUpvalues(
	instructions: Instruction[],
	descriptors: UpvalueDesc[],
	names: string[],
	closureUpvalues: (protoIndex: number) => UpvalueDesc[],
): void {
	const count = descriptors.length;
	if (count === 0) {
		return;
	}

	const remap = new Int32Array(count);
	const childProtos = new Set<number>();
	for (let instructionIndex = 0; instructionIndex < instructions.length; instructionIndex += 1) {
		const instruction = instructions[instructionIndex];
		switch (instruction.op) {
			case OpCode.GETUP:
			case OpCode.SETUP:
				remap[instruction.b] = 1;
				continue;
			case OpCode.CLOSURE:
				break;
			default:
				continue;
		}
		if (instruction.closureAddressRegister) {
			// An indirectly addressed function record can capture any upvalue in the creating frame.
			return;
		}
		const protoIndex = instruction.b;
		childProtos.add(protoIndex);
		const childDescriptors = closureUpvalues(protoIndex);
		for (let descriptorIndex = 0; descriptorIndex < childDescriptors.length; descriptorIndex += 1) {
			const descriptor = childDescriptors[descriptorIndex];
			if (!descriptor.inStack) {
				remap[descriptor.index] = 1;
			}
		}
	}

	let liveCount = 0;
	for (let index = 0; index < count; index += 1) {
		liveCount += remap[index];
	}
	if (liveCount === count) {
		return;
	}

	let nextIndex = 0;
	for (let index = 0; index < count; index += 1) {
		if (remap[index] === 0) {
			continue;
		}
		remap[index] = nextIndex;
		descriptors[nextIndex] = descriptors[index];
		names[nextIndex] = names[index];
		nextIndex += 1;
	}
	descriptors.length = liveCount;
	names.length = liveCount;

	for (let instructionIndex = 0; instructionIndex < instructions.length; instructionIndex += 1) {
		const instruction = instructions[instructionIndex];
		switch (instruction.op) {
			case OpCode.GETUP:
			case OpCode.SETUP:
				instruction.b = remap[instruction.b];
				break;
			default:
				break;
		}
	}
	for (const protoIndex of childProtos) {
		const childDescriptors = closureUpvalues(protoIndex);
		for (let descriptorIndex = 0; descriptorIndex < childDescriptors.length; descriptorIndex += 1) {
			const descriptor = childDescriptors[descriptorIndex];
			if (!descriptor.inStack) {
				descriptor.index = remap[descriptor.index];
			}
		}
	}
}
