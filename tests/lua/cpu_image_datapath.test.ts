import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { StringValue } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/machine/execution_address_space';
import {
	INSTRUCTION_BYTES,
	writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { encodeFixedCallArgCount, OpCode } from '../../machine/ts/spec/blua32/opcode';
import {
	createTestSystemCpu,
	linkRawTestSystemBlua32,
} from '../helpers/blua32';

test('CPU function bounds come from the physical function record instead of the decoded host graph', () => {
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.JMP, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.KTRUE, 0, 0, 0, 0);
	writeInstruction(text, 2, OpCode.SETGL, 0, 0, 0, 0);
	writeInstruction(text, 3, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(text, 4, OpCode.RFE, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text,
		functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 1 },
			{ firstWord: 4, wordCount: 1 },
		],
		globalNames: ['physical_record_seen'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 1,
		exceptionFunctionIndex: 1,
	});
	const { cpu, executionAddressSpace } = createTestSystemCpu(image);
	const startupFunction = image.image.functions[0];
	const decodedImage = executionAddressSpace.resolveSystemDomain();
	decodedImage.layout.functions[0].codeByteCount = INSTRUCTION_BYTES;

	cpu.replaceExecutionImage(decodedImage);
	cpu.writeFrameExecution(
		0,
		SYSTEM_EXECUTION_DOMAIN_ID,
		startupFunction.address,
		startupFunction.codeAddress,
	);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('physical_record_seen'))),
		true,
	);
});

test('CPU closure captures come from the physical upvalue table instead of the decoded host graph', () => {
	const text = new Uint8Array(9 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 1, 0);
	writeInstruction(text, 3, OpCode.CALL, 1, encodeFixedCallArgCount(0), 1, 0);
	writeInstruction(text, 4, OpCode.SETGL, 1, 0, 0, 0);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0, 0);
	writeInstruction(text, 6, OpCode.GETUP, 0, 0, 0, 0);
	writeInstruction(text, 7, OpCode.RET, 0, 1, 0, 0);
	writeInstruction(text, 8, OpCode.RFE, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text,
		functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 2 },
			{
				firstWord: 6,
				wordCount: 2,
				staticClosure: false,
				upvalueDescs: [{ inStack: true, index: 0 }],
			},
			{ firstWord: 8, wordCount: 1 },
		],
		constants: [7],
		globalNames: ['physical_upvalue_seen'],
		startupFunctionIndex: 0,
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
	});
	const { cpu, executionAddressSpace } = createTestSystemCpu(image);
	const startupFunction = image.image.functions[0];
	const decodedImage = executionAddressSpace.resolveSystemDomain();
	decodedImage.layout.functions[1].upvalues[0] = { inStack: false, index: 31 };

	cpu.replaceExecutionImage(decodedImage);
	cpu.writeFrameExecution(
		0,
		SYSTEM_EXECUTION_DOMAIN_ID,
		startupFunction.address,
		startupFunction.codeAddress,
	);

	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(
		cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('physical_upvalue_seen'))),
		7,
	);
});
