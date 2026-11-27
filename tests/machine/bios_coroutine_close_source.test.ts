import { test } from 'node:test';
import { verifyPinnedBluaSource } from '../helpers/blua_source_proof';

test('ordinary Coroutine close uses exact real Thread admission, retirement and result order', () => {
	verifyPinnedBluaSource('machine/bios/kernel/coroutine_close.lua', '91ce105cf4d9649c20b9e04205dede1df9f8b297', {
		T: ['machine/ts/machine/cpu/cpu.ts', '17b0726f2ad115e6a2e399ce94c64a7dbe7b7e5aa499174a5da4b7c4dfba29ee'],
		C: ['machine/cpp/machine/cpu/cpu.cpp', '1ec8dc95e0b03e96d3083c3e61a8afb84bfecb83c95b9b8ab9feb86f773934de'],
		G: ['machine/ts/machine/cpu/gc_heap.ts', '6e2746a82ca64ac5080595cd45c28d54d671cd60f7d412392548739bd4c03cdd'],
		H: ['machine/cpp/machine/cpu/gc_heap.cpp', '5397a567b47e8dc62fea3d1cdb9d3af95e94a260bdfb07a21658c915a0b95610'],
		R: ['machine/ts/machine/cpu/thread_record.ts', '85a1bd9f2ba7e0369bdd0d6741d7cea694caf9fd092e0c4e0bf9c65ed37db518'],
		J: ['machine/cpp/machine/cpu/thread_record.h', '374881cdd8f9d3774f0653516397c3ae221cb074cb7a02d018b1f37186866dd0'],
		O: ['machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3'],
		B: ['machine/ts/machine/cpu/value.ts', 'b4d93520ccb6fc7ec45f1f070b817eb46605f22405549643a25b3afb0e5f6723'],
		F: ['machine/ts/spec/blua32/cop0.ts', '87510e6e2325f1923a2d37d6d8b6ae0e45e36589d5615506f098fefb3513c4f1'],
	}, [
		['T', 4534, 4536], ['T', 4541, 4545], ['T', 4683, 4689], ['T', 4692, 4696],
		['C', 1278, 1280], ['C', 1286, 1291], ['C', 1425, 1429], ['C', 1431, 1435],
		['G', 140, 143], ['G', 158, 159], ['H', 253, 256], ['H', 267, 269],
	]);
});
