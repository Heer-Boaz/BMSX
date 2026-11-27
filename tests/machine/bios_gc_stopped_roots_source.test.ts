import { test } from 'node:test';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';

const basis = '7adffc6751300300166f0188f367ff7bab224a13';
const port = 'machine/bios/kernel/gc_stopped_roots.lua';
const sources = {
	T: ['machine/ts/machine/cpu/cpu.ts', 'd338f2e21c19dfa2e542b4a3524f0f347442944355c5829343431195ea4cd8aa'],
	C: ['machine/cpp/machine/cpu/cpu.cpp', '2d322cccaa7005c90fca0310cbb1c91bb3f115d86598a6f04ad491665077b40e'],
	F: ['machine/cpp/machine/cpu/cpu_heap_service.inl', 'c15063c3d59cd8b9b6760c7fe9dffd777d6050641e18b48ba2b8557df0586dcb'],
	S: ['machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97'],
	R: ['machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686'],
	O: ['machine/ts/spec/blua32/execution_domain.ts', '2ff1ac7fa66811535ba2eacd9634d9d115a4a21dd5d52ec7afccfffabce63f4d'],
	M: ['machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
} as const;

test('stopped-root publication maps old warm ownership and String work without using private CPU root transport', () => {
	// The old String-root projection (T:5391-5395, C:3286-3290) is not
	// performed by this publisher: gc_root_banks reads the cursor
	// (formerly GcHeap TS:582/C++:621) and scans installed bindings directly.
	// Both operations are covered by bios_gc_root_banks_source.test.ts.
	verifyPinnedBluaSource(port, basis, sources, [
		['T', 5337, 5337], ['C', 3232, 3232],
		['T', 5384, 5384], ['C', 3275, 3275],
		['F', 332, 332], ['F', 334, 334], ['F', 337, 337],
		['S', 453, 454], ['R', 443, 444],
	]);
});
