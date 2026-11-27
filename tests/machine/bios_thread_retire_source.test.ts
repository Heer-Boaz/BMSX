import { test } from 'node:test';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';

test('warm Thread retirement maps the original resumer order, frame release, upvalues, and barrier', () => {
	verifyPinnedBluaSource('machine/bios/kernel/thread_retire.lua', '91ce105cf4d9649c20b9e04205dede1df9f8b297', {
		T: ['machine/ts/machine/cpu/cpu.ts', '17b0726f2ad115e6a2e399ce94c64a7dbe7b7e5aa499174a5da4b7c4dfba29ee'],
		C: ['machine/cpp/machine/cpu/cpu.cpp', '1ec8dc95e0b03e96d3083c3e61a8afb84bfecb83c95b9b8ab9feb86f773934de'],
		I: ['machine/ts/machine/cpu/thread.ts', '9cf05a8045563e90b074b796ee7f6bc15de1d2ffc94abbef5073223689a4c9f2'],
		J: ['machine/cpp/machine/cpu/thread.cpp', '1f2ec0800ff19e7617184a4435c46627e0de6dbc3eb683f062c5d70c3a7192aa'],
		R: ['machine/ts/machine/cpu/thread_record.ts', '85a1bd9f2ba7e0369bdd0d6741d7cea694caf9fd092e0c4e0bf9c65ed37db518'],
		S: ['machine/cpp/machine/cpu/thread_record.h', '374881cdd8f9d3774f0653516397c3ae221cb074cb7a02d018b1f37186866dd0'],
		F: ['machine/ts/machine/cpu/call_state.ts', '23e1aecb673364007f4924560fb38fc28cab335e16601e761cfb05b123977cc6'],
		G: ['machine/cpp/machine/cpu/call_state.h', 'd0c7a2afbcc4b287d2c1d3830d6484eab1f41e0e670b31787a13e5f743480d31'],
		U: ['machine/ts/machine/cpu/upvalue.ts', '92a1de7c466aaf1f1d33621b25825cc8016d02b864422588c83794acb958ccb9'],
		V: ['machine/cpp/machine/cpu/upvalue.cpp', '54aa814365d158b4edc73d77b56dcb746d61c8ec72e2f37903116e531c8f526f'],
		W: ['machine/cpp/machine/cpu/upvalue.h', '3dd1a5f4bc3b2e067dcc403008561e7f0beca6ded5580ac796eaa1867d6f20d1'],
		H: ['machine/ts/machine/cpu/gc_heap.ts', '6e2746a82ca64ac5080595cd45c28d54d671cd60f7d412392548739bd4c03cdd'],
		K: ['machine/cpp/machine/cpu/gc_heap.cpp', '5397a567b47e8dc62fea3d1cdb9d3af95e94a260bdfb07a21658c915a0b95610'],
		P: ['machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3'],
		A: ['machine/ts/machine/cpu/heap_allocator.ts', 'fc9c0c0e9f6db81f27a6725bf4ef5d7062fb9b4114df95e26afeb12c76ea4432'],
		B: ['machine/cpp/machine/cpu/heap_allocator.h', 'e033e7f412e320bcb43bbd0f0851d6aad259db0ad9188e970729faf6b8213fb7'],
		M: ['machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
	}, [
		// Stalled bus, completion pointer and thread-switch latches are CPU
		// effects. Cleared host views are not part of the guest record.
		['T', 860, 860], ['T', 862, 867], ['T', 869, 878], ['T', 880, 880],
		['C', 3195, 3195], ['C', 3197, 3202], ['C', 3204, 3213], ['C', 3215, 3215],
		['T', 4298, 4308], ['T', 4310, 4312], ['C', 2977, 2987], ['C', 2989, 2991],
		['I', 263, 265], ['J', 285, 287],
		['U', 39, 50], ['V', 42, 53], ['U', 53, 60], ['V', 56, 62],
		['H', 140, 143], ['H', 155, 156], ['K', 253, 256], ['K', 293, 294],
	]);
});
