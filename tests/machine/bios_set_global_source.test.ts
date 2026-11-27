import { test } from 'node:test';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';

const port = 'machine/bios/kernel/set_global.lua';
const basis = 'f72579c7f15795cedbd00f71ed7edd94dda5aeb5';
const sources = {
	C: ['machine/cpp/machine/cpu/cpu.cpp', '5b40db9bc22627d281b1775d750fef5aa24c3f3b434bc7c9a11ae46f1ecbc67a'],
	T: ['machine/ts/machine/cpu/cpu.ts', 'f35e6fbfea3e39ab298927122fbcc919f4b5a3e8e555573985d38834dcf9837a'],
	B: ['machine/cpp/machine/cpu/global_bank.cpp', 'a158debd0a906d89af2c71b46ba049e77052789aadd74f2cd599d0504de863a6'],
	G: ['machine/ts/machine/cpu/global_bank.ts', 'd1576d6705a87ed23c01b46f06f89208b40c5d6590e040227399c53150c84ca4'],
	H: ['machine/cpp/machine/cpu/lua_heap.cpp', '5f20bff8a99c290a3bbdc7eb984aa10a7c379560bd814d0c0b7cb5df9f0f6a65'],
	M: ['machine/ts/spec/blua32/execution_domain.ts', 'f8dadbe45f058cc095fa5888358014e214d44d9d408c4f067cfc8a7b703b13d8'],
	F: ['machine/ts/spec/blua32/cop0.ts', '34f0b7f26f39afdf43c399e1e88a40b57271bc0617546d994a8e19899766439b'],
} as const;

test('firmware setglobal maps the builtin arguments, namespace admission, mutation and faults', () => {
	verifyPinnedBluaSource(port, basis, sources, [
		['C', 1320, 1323], ['T', 4651, 4659], ['C', 637, 638], ['T', 2970, 2971],
		['B', 79, 101], ['G', 90, 113], ['H', 84, 90], ['H', 95, 109], ['H', 172, 178],
		['F', 60, 61], ['M', 13, 16],
	]);
});
