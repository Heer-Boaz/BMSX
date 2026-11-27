import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET,
	BLUA32_STRING_NEXT_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE,
} from '../../machine/ts/spec/blua32/image_format';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const port = 'machine/bios/kernel/system_image_bind.lua';
const basis = 'b8fd922892acf5a776f4a69164d779d6f9b6bec9';
const sources = {
	T: ['machine/ts/machine/cpu/cpu.ts', '72c08041ee82d51e1ff4a2a8e364b17ec1fe9858fcd0e1c1dc4076d127e24036'],
	C: ['machine/cpp/machine/cpu/cpu.cpp', 'ec6b0d4ba3de41ed5ed72e4c576f5e431265378ebcf7996a4b1ecb605186d0eb'],
	F: ['machine/ts/spec/blua32/image_format.ts', 'c60839f38c8ef13b57310c84d576da48d127715b8b2cb6b2aed3ea69a5559cf5'],
	S: ['machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97'],
	R: ['machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686'],
	L: ['machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf'],
	N: ['machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e'],
	G: ['machine/ts/machine/cpu/global_bank.ts', 'ef0b89271240a78e5cc9cadcf87301679ee815e793158736c9819db899fc2c2d'],
	H: ['machine/cpp/machine/cpu/global_bank.cpp', '26d2e34a13a00959fe4a7dcfd9a84b18e3548c212d0458e1822f3cefac60777f'],
} as const;

test('cold image binding maps native name slots, String resolution and binding destinations', () => {
	verifyPinnedBluaSource(port, basis, sources, [
		['F', 10, 15], ['F', 48, 50], ['F', 52, 53], ['F', 55, 62],
		['S', 244, 254], ['R', 247, 253], ['T', 1026, 1035], ['C', 304, 312],
		['T', 1139, 1144], ['C', 420, 426], ['T', 996, 996], ['T', 1001, 1003], ['T', 1005, 1006], ['C', 287, 289], ['C', 291, 291],
		['G', 93, 97], ['H', 84, 88],
	]);
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const { chunk } = workspace.updateFile(port, readFileSync(port, 'utf8'));
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const layouts = [
		['immutable_image_operands', BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET + 4, {
			constants: BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET, constants_count: BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
			global_names: BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, global_count: BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
			system_names: BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, system_count: BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
		}],
		['constant_record', BLUA32_CONSTANT_RECORD_SIZE, { tag: BLUA32_CONSTANT_TAG_OFFSET, word: BLUA32_CONSTANT_PAYLOAD_OFFSET }],
		['rom_string', BLUA32_STRING_RECORD_HEADER_SIZE, { hash: BLUA32_STRING_HASH_OFFSET, length: BLUA32_STRING_LENGTH_OFFSET, next: BLUA32_STRING_NEXT_OFFSET }],
		['operand_bindings', 28, { global_base: 0, global_capacity: 4, global_count: 8, system_base: 12, system_capacity: 16, system_count: 20, image_base: 24 }],
	] as const;
	for (const [name, size, fields] of layouts) {
		const layout = types.resolve(port, { name, arrayLengths: [], span: chunk.body.get(0).span }).struct!;
		assert.equal(layout.size, size, name);
		for (const [field, offset] of Object.entries(fields)) assert.equal(layout.fields.get(field)?.offset, offset, `${name}.${field}`);
	}
});
