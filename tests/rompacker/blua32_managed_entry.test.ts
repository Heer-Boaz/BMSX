import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_RESIDENT, BLUA32_FUNCTION_STATIC } from '../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';

for (const optLevel of [0, 3] as const) test(`a managed entry links a plain ROM function record without module initialization (O${optLevel})`, () => {
	const { linked, object } = buildBlua32Image({
		luaModules: [
			['entry', "module<entry>\nlocal entries<const> = require('bmsx/startup')\nreturn entries.receive"],
			['receive', 'return function(fn, ...) return true, fn(...) end'],
		].map(([path, source]) => ({ path, displayPath: `${path}.lua`, source, chunk: parseLuaChunk(source, path).chunk })),
		managedEntries: [{ symbol: 'receive', path: 'receive' }],
		generatedLuaModules: [],
		loadAddress: SYSTEM_ROM_BASE + 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		optLevel,
		traceStatements: 'erase',
		domain: 'system',
		biosExports: [],
	});
	const index = linked.symbols.metadata.functionIds.indexOf('module:receive/module');
	assert.notEqual(index, -1);
	const { layout } = linked, record = layout.functions[index];
	assert.equal(record.numParams, 1);
	assert.equal(record.isVararg, true);
	assert.equal(record.upvalues.length, 0);
	assert.equal(record.flags & (BLUA32_FUNCTION_CODE | BLUA32_FUNCTION_RESIDENT | BLUA32_FUNCTION_STATIC), 0);
	const relocation = object.link.constValueRelocs.find(reloc => reloc.kind === 'link_value' && reloc.modulePath === 'bmsx/startup');
	assert.ok(relocation);
	assert.deepEqual(layout.constants[relocation.constIndex], integerConstant(record.address));
	assert.equal(linked.symbols.moduleFunctions.some(module => module.path === 'receive'), false);
	const ops: OpCode[] = [];
	for (let pc = record.codeAddress; pc < record.codeAddress + record.codeByteCount;) {
		const instruction = decodeBlua32InstructionAtPc(linked.bytes, layout.address, pc);
		ops.push(instruction.op);
		pc = instruction.pc + INSTRUCTION_BYTES;
	}
	assert.ok(ops.includes(OpCode.VARARG) && ops.includes(OpCode.CALL) && ops.includes(OpCode.RET));
	assert.ok(!ops.includes(OpCode.CLOSURE));
});
