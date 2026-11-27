import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const port = 'machine/bios/kernel/global_bank.lua';
const basis = 'eac0ec35704ad84157f19ec0ed692838324f367b';
const sources = {
	T: ['machine/ts/machine/cpu/global_bank.ts', 'ef0b89271240a78e5cc9cadcf87301679ee815e793158736c9819db899fc2c2d'],
	C: ['machine/cpp/machine/cpu/global_bank.cpp', '26d2e34a13a00959fe4a7dcfd9a84b18e3548c212d0458e1822f3cefac60777f'],
	H: ['machine/cpp/machine/cpu/global_bank.h', '406b824cef85cdcaa923567dbc3d0395ab3be60c482649fdab667626e4578da6'],
	V: ['machine/ts/machine/cpu/value_slots.ts', '5392a460b99ca64717c81da1574bad1df8353a5c2133fb37ddab528d640cbe70'],
	W: ['machine/cpp/machine/cpu/value_slots.h', '222a93a50ec174bd8690873ef75d1ef5f628e5a861da3f7767753c754d963e26'],
	K: ['machine/ts/machine/cpu/value.ts', 'b4d93520ccb6fc7ec45f1f070b817eb46605f22405549643a25b3afb0e5f6723'],
	L: ['machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf'],
	N: ['machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e'],
	G: ['machine/ts/machine/cpu/gc_heap.ts', 'ab8032dfa68a85160d2cf0ed7d2bddd84f395e730d600e049e90938950983077'],
	J: ['machine/cpp/machine/cpu/gc_heap.cpp', '0badf98ed9e0706b03190d6531f201ac47276f0a858b25020a1177ac2e68f4c0'],
	S: ['machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97'],
	R: ['machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686'],
} as const;

test('BIOS name-bank publication maps the native probe, copy and insertion effects', () => {
	// Admission/retry belongs to the caller. The reference trajectories enter
	// this leaf with the same selected backing; there are no guest-view caches.
	verifyPinnedBluaSource(port, basis, sources, [
		['H', 10, 12], ['T', 60, 68], ['T', 72, 75], ['T', 79, 82], ['T', 84, 86], ['T', 101, 108],
		['G', 191, 195], ['J', 112, 116], ['S', 448, 449], ['S', 453, 454], ['R', 439, 439], ['R', 443, 444],
		['C', 46, 54], ['C', 56, 56], ['C', 60, 63], ['C', 67, 72], ['C', 75, 78], ['C', 92, 100],
	]);
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const { chunk } = workspace.updateFile(port, readFileSync(port, 'utf8'));
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const layout = types.resolve(port, { name: 'namespace_bank', arrayLengths: [], span: chunk.body.get(0).span }).struct!;
	assert.equal(layout.size, 12);
	assert.deepEqual(Array.from(layout.fields, ([name, field]) => [name, field.offset]),
		[['base', 0], ['capacity', 4], ['count', 8]]);
});
