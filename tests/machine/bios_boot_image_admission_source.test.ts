import { test } from 'node:test';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';

const port = 'machine/bios/kernel/boot_image_admission.lua';
const basis = '57945b22121ef1e697fd04ef3246da06903921c5';
const sources = {
	L: ['machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf'],
	N: ['machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e'],
	G: ['machine/ts/machine/cpu/gc_heap.ts', '6e2746a82ca64ac5080595cd45c28d54d671cd60f7d412392548739bd4c03cdd'],
	H: ['machine/cpp/machine/cpu/gc_heap.cpp', '5397a567b47e8dc62fea3d1cdb9d3af95e94a260bdfb07a21658c915a0b95610'],
	T: ['machine/ts/machine/cpu/cpu.ts', 'd338f2e21c19dfa2e542b4a3524f0f347442944355c5829343431195ea4cd8aa'],
	C: ['machine/cpp/machine/cpu/cpu.cpp', '2d322cccaa7005c90fca0310cbb1c91bb3f115d86598a6f04ad491665077b40e'],
	F: ['machine/cpp/machine/cpu/cpu_heap_service.inl', 'c15063c3d59cd8b9b6760c7fe9dffd777d6050641e18b48ba2b8557df0586dcb'],
	B: ['machine/ts/machine/cpu/global_bank.ts', '692cc8bc57cb4f992d430ddae277548d62006452f160045d86eea0996c807041'],
	D: ['machine/cpp/machine/cpu/global_bank.cpp', 'd4c7cdb9c2c4296b66847b333ea3ba69e5fe7af061628c1fabae355ee62572a2'],
} as const;

test('stopped image admission maps Idle pacing, one retry token, and roots of already registered names', () => {
	verifyPinnedBluaSource(port, basis, sources, [
		['L', 73, 106], ['L', 132, 168], ['N', 81, 116], ['N', 142, 179],
		['G', 1009, 1025], ['H', 1099, 1114], ['T', 5302, 5304], ['T', 5306, 5314], ['C', 2733, 2735], ['C', 2737, 2744],
		['T', 4148, 4163], ['F', 327, 343],
	]);
});
