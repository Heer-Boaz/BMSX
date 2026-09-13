import { CapturedLocalKind } from '../../toolchain/ts/lua/compiler/capture_kind';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import {
	BLUA32_SYMBOLS_VERSION,
	blua32InlineCallSitesAtPc,
	blua32LocalSlotLiveAtPc,
	decodeBlua32SymbolsImage,
	encodeBlua32SymbolsImage,
	type Blua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';

test('BLua32 function names and inline call-site chains round-trip through the symbols codec', () => {
	const outerCallRange = {
		path: 'cart.lua',
		start: { line: 4, column: 2 },
		end: { line: 4, column: 14 },
	};
	const innerCallRange = {
		path: 'cart.lua',
		start: { line: 11, column: 3 },
		end: { line: 11, column: 18 },
	};
	const inlineCallSites = [
		{ calleeFunctionId: 'outer', callRange: outerCallRange },
		{ calleeFunctionId: 'inner', callRange: innerCallRange },
	];
	const symbols: Blua32SymbolsImage = {
		version: BLUA32_SYMBOLS_VERSION,
		imageAddress: 0x1000,
		functionAddresses: [],
		moduleFunctions: [],
		initFunctionAddress: 0,
		initParticipants: [],
		staticLayoutToken: { lo: 0, hi: 0 },
		metadata: {
			functionIds: ['module:cart/module/anon:4:2:4:14'],
			functionDisplayNames: ['invoke'],
			functionDefinitions: [innerCallRange],
			globalNames: [],
			systemGlobalNames: [],
			staticFunctionIdBySlot: {},
			debugRanges: [innerCallRange, null],
			debugInlineCallSiteChains: [[], inlineCallSites],
			debugInlineCallSiteChainIds: [1, 0],
			statementPointsByFunction: [],
			resumePointsByFunction: [],
			localSlotsByFunction: [[{ name: 'value', registerIndex: 1, definition: innerCallRange,
				scope: outerCallRange, inlineCallSites, liveWordRanges: [{ start: 2, end: 4 }, { start: 6, end: 8 }] }]],
			capturedLocals: [{
				kind: CapturedLocalKind.Local,
				functionId: 'module:cart/module', name: 'value',
				definition: innerCallRange,
			}],
			upvalueBindingsByFunction: [[0]],
		},
	};

	const decoded = decodeBlua32SymbolsImage(encodeBlua32SymbolsImage(symbols));
	assert.deepEqual(decoded.metadata.localSlotsByFunction, symbols.metadata.localSlotsByFunction);
	const slot = decoded.metadata.localSlotsByFunction[0][0];
	for (let word = 0; word <= 9; word += 1) {
		assert.equal(blua32LocalSlotLiveAtPc(slot, 0x2000, 0x2000 + word * INSTRUCTION_BYTES),
			word >= 2 && word < 4 || word >= 6 && word < 8, 'word intervals are half-open with explicit gaps');
	}
	assert.equal(blua32LocalSlotLiveAtPc({ ...slot, liveWordRanges: [] }, 0x2000, 0x2000), false);
	assert.deepEqual(decoded.metadata.capturedLocals, symbols.metadata.capturedLocals);
	assert.deepEqual(decoded.metadata.upvalueBindingsByFunction, [[0]]);
	assert.deepEqual(decoded.metadata.functionDisplayNames, ['invoke']);
	assert.deepEqual(decoded.metadata.debugInlineCallSiteChains, [[], inlineCallSites]);
	assert.deepEqual(decoded.metadata.debugInlineCallSiteChainIds, [1, 0]);
	assert.deepEqual(blua32InlineCallSitesAtPc(decoded, 0x2000, 0x2000), inlineCallSites);
	assert.deepEqual(blua32InlineCallSitesAtPc(decoded, 0x2000, 0x2000 + INSTRUCTION_BYTES), []);
	const removed: Blua32SymbolsImage = {
		...symbols,
		metadata: {
			...symbols.metadata,
			functionDefinitions: [null],
			capturedLocals: [{ ...symbols.metadata.capturedLocals[0], kind: CapturedLocalKind.Parameter, definition: null }],
		},
	};
	assert.deepEqual(decodeBlua32SymbolsImage(encodeBlua32SymbolsImage(removed)), removed);
	assert.throws(
		() => decodeBlua32SymbolsImage(encodeBlua32SymbolsImage({ ...symbols, version: BLUA32_SYMBOLS_VERSION - 1 })),
		/BLua32 symbols version is unsupported/,
	);
});
