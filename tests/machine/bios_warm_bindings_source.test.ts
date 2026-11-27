import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const port = 'machine/bios/kernel/warm_bindings.lua';
const bindings = 'machine/bios/kernel/image_string_bindings.lua';
const basis = '91ce105cf4d9649c20b9e04205dede1df9f8b297';
const sources = {
	T: ['machine/ts/machine/cpu/cpu.ts', '17b0726f2ad115e6a2e399ce94c64a7dbe7b7e5aa499174a5da4b7c4dfba29ee'],
	C: ['machine/cpp/machine/cpu/cpu.cpp', '1ec8dc95e0b03e96d3083c3e61a8afb84bfecb83c95b9b8ab9feb86f773934de'],
	G: ['machine/ts/machine/cpu/global_bank.ts', 'ef0b89271240a78e5cc9cadcf87301679ee815e793158736c9819db899fc2c2d'],
	H: ['machine/cpp/machine/cpu/global_bank.cpp', '26d2e34a13a00959fe4a7dcfd9a84b18e3548c212d0458e1822f3cefac60777f'],
	L: ['machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf'],
	N: ['machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e'],
	S: ['machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97'],
	R: ['machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686'],
	I: ['machine/ts/machine/cpu/execution_image.ts', '722ea8a544028d32ccb5e20e369acbb75d2386d4906695f8d8d65b782add0272'],
	J: ['machine/cpp/machine/cpu/execution_image.h', '1179cb8c6d36289d7cc504c90770623f81b18c279a068dfa3576feadce2f36ff'],
	E: ['machine/ts/spec/blua32/execution_domain.ts', 'b849667b09e16a20c4446a52de0fc7056f29cb0fcb2446f33164755b3f52c4fa'],
	M: ['machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
} as const;

test('warm retirement pins both native boundaries and maps every guest backing release and descriptor effect', () => {
	verifyPinnedBluaSource(port, basis, sources, [
		['T', 949, 950], ['C', 627, 628], ['G', 50, 53], ['H', 32, 34],
		['L', 288, 291], ['N', 291, 294], ['T', 931, 931], ['C', 223, 224],
		['T', 1016, 1018], ['C', 303, 304], ['T', 934, 934], ['C', 228, 228], ['S', 127, 128], ['R', 137, 138],
	]);
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port, bindings]));
	const { chunk } = workspace.updateFile(bindings, readFileSync(bindings, 'utf8'));
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const pair = types.resolve(bindings, { name: 'installed_image_binding', arrayLengths: [], span: chunk.body.get(0).span }).struct!;
	assert.equal(pair.size, 16);
	assert.equal(pair.fields.get('base')?.offset, 0);
	assert.equal(pair.fields.get('bytes')?.offset, 4);
	assert.equal(pair.fields.get('strings')?.offset, 8);
	assert.equal(pair.fields.get('ram_strings')?.offset, 12);
});
