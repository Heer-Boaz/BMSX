import assert from 'node:assert/strict';
import test from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import * as D from '../../machine/ts/spec/blua32/diagnostics';
import { CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET } from '../../machine/ts/spec/bmsx/rom_package';
import { runtimeLuaFrameScopes } from '../../ide/runtime/lua_inspection';
import { compileLuaSource } from '../lua/cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';

const source = `local shared<const> = { answer = 42 }
local run = function(seed, ...)
	local captured = seed
	local outer<const> = function(value)
		local middle<const> = value + seed
		local inner<const> = function(bonus)
			captured = captured + bonus
			return captured + shared.answer + middle
		end
		return inner(value)
	end
	local result = outer(2)
	do
		local result = 99
		result = result + seed
	end
	return result + outer(3)
end
return run(40)`;

for (const optLevel of [0, 3] as const) test(`O${optLevel}: packed firmware scopes agree with installed Studio scopes at every mapped PC`, () => {
	const linked = linkTestSystemBlua32(compileLuaSource(source, 'scope_probe', optLevel),
		new Map([['scope_probe', { displayPath: 'scope_probe.lua', source }]]));
	const bytes = linked.romBytes;
	const directory = readLE32(bytes, CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET);
	const field = (record: number, offset: number) => readLE32(bytes, directory + record + offset);
	const functions = field(0, D.BLUA32_DIAGNOSTIC_DIRECTORY_FUNCTION_TABLE_OFFSET);
	const frames = field(0, D.BLUA32_DIAGNOSTIC_DIRECTORY_FRAME_TABLE_OFFSET);
	const bindings = field(0, D.BLUA32_DIAGNOSTIC_DIRECTORY_BINDING_TABLE_OFFSET);
	const intervals = field(0, D.BLUA32_DIAGNOSTIC_DIRECTORY_INTERVAL_TABLE_OFFSET);
	const decoder = new TextDecoder();
	const nameAt = (record: number, nameOffset: number, bytesOffset: number) => {
		const start = directory + field(record, nameOffset);
		return decoder.decode(bytes.subarray(start, start + field(record, bytesOffset)));
	};
	const contains = (start: number, count: number, word: number) => {
		for (let index = start; index < start + count; index++) {
			const at = intervals + index * D.BLUA32_DIAGNOSTIC_INTERVAL_RECORD_SIZE;
			if (field(at, D.BLUA32_DIAGNOSTIC_INTERVAL_START_OFFSET) <= word && word < field(at, D.BLUA32_DIAGNOSTIC_INTERVAL_END_OFFSET)) return true;
		}
		return false;
	};
	let compared = 0, inlined = 0;
	assert.equal(field(0, D.BLUA32_DIAGNOSTIC_DIRECTORY_FUNCTION_COUNT_OFFSET), linked.image.functions.length);
	for (let functionIndex = 0; functionIndex < linked.image.functions.length; functionIndex++) {
		const fn = linked.image.functions[functionIndex];
		const record = functions + functionIndex * D.BLUA32_DIAGNOSTIC_FUNCTION_RECORD_SIZE;
		assert.equal(field(record, D.BLUA32_DIAGNOSTIC_FUNCTION_ADDRESS_OFFSET), fn.address);
		assert.equal(field(record, D.BLUA32_DIAGNOSTIC_FUNCTION_CODE_ADDRESS_OFFSET), fn.codeAddress);
		const frameStart = field(record, D.BLUA32_DIAGNOSTIC_FUNCTION_FRAME_START_OFFSET);
		const frameCount = field(record, D.BLUA32_DIAGNOSTIC_FUNCTION_FRAME_COUNT_OFFSET);
		for (let word = 0; word < fn.codeByteCount / 4; word++) {
			const pc = fn.codeAddress + word * 4;
			const textWord = (pc - linked.image.header.textAddress) / 4;
			if (linked.symbols.metadata.debugRanges[textWord] === null) continue;
			const chain = linked.symbols.metadata.debugInlineCallSiteChains[linked.symbols.metadata.debugInlineCallSiteChainIds[textWord]];
			for (let depth = 0; depth <= chain.length; depth++) {
				const matching: number[] = [];
				for (let index = frameStart; index < frameStart + frameCount; index++) {
					const at = frames + index * D.BLUA32_DIAGNOSTIC_FRAME_RECORD_SIZE;
					if (field(at, D.BLUA32_DIAGNOSTIC_FRAME_DEPTH_OFFSET) === depth
						&& contains(field(at, D.BLUA32_DIAGNOSTIC_FRAME_ACTIVE_START_OFFSET), field(at, D.BLUA32_DIAGNOSTIC_FRAME_ACTIVE_COUNT_OFFSET), word)) matching.push(at);
				}
				assert.equal(matching.length, 1, 'one exact logical activation owns this PC/depth');
				const frame = matching[0];
				const expectedName = depth === 0 ? linked.symbols.metadata.functionDisplayNames[functionIndex]
					: linked.symbols.metadata.functionDisplayNames[linked.symbols.metadata.functionIds.indexOf(chain[depth - 1].calleeFunctionId)];
				assert.equal(nameAt(frame, D.BLUA32_DIAGNOSTIC_FRAME_NAME_OFFSET, D.BLUA32_DIAGNOSTIC_FRAME_NAME_BYTES_OFFSET), expectedName);
				const actual = new Map<string, unknown>();
				const start = field(frame, D.BLUA32_DIAGNOSTIC_FRAME_BINDING_START_OFFSET), count = field(frame, D.BLUA32_DIAGNOSTIC_FRAME_BINDING_COUNT_OFFSET);
				for (let index = start; index < start + count; index++) {
					const slot = bindings + index * D.BLUA32_DIAGNOSTIC_BINDING_RECORD_SIZE;
					if (!contains(field(slot, D.BLUA32_DIAGNOSTIC_BINDING_VISIBLE_START_OFFSET), field(slot, D.BLUA32_DIAGNOSTIC_BINDING_VISIBLE_COUNT_OFFSET), word)) continue;
					const flags = field(slot, D.BLUA32_DIAGNOSTIC_BINDING_FLAGS_OFFSET);
					const live = contains(field(slot, D.BLUA32_DIAGNOSTIC_BINDING_LIVE_START_OFFSET), field(slot, D.BLUA32_DIAGNOSTIC_BINDING_LIVE_COUNT_OFFSET), word);
					actual.set(nameAt(slot, D.BLUA32_DIAGNOSTIC_BINDING_NAME_OFFSET, D.BLUA32_DIAGNOSTIC_BINDING_NAME_BYTES_OFFSET), {
						isConst: (flags & D.BLUA32_DIAGNOSTIC_BINDING_CONST) !== 0,
						location: live ? { inStack: (flags & D.BLUA32_DIAGNOSTIC_BINDING_UPVALUE) === 0, index: field(slot, D.BLUA32_DIAGNOSTIC_BINDING_INDEX_OFFSET) } : null,
					});
				}
				const scopes = runtimeLuaFrameScopes({ executionDomainId: -1, toolingImage: { layout: linked.image, symbols: linked.symbols },
					functionAddress: fn.address, functionIndex, tracePc: pc }, depth);
				const expected = new Map<string, unknown>();
				for (const scope of [scopes[1], scopes[0]]) {
					assert.equal(scope.status, 'available');
					if (scope.status === 'available') for (const binding of scope.bindings) expected.set(binding.name, { isConst: binding.isConst, location: binding.location });
				}
				assert.deepEqual(actual, expected, `${expectedName} at ${pc}, depth ${depth}`);
				compared++;
				if (depth !== 0) inlined++;
			}
		}
	}
	assert.ok(compared > 40);
	assert.equal(inlined > 0, optLevel === 3);
});
