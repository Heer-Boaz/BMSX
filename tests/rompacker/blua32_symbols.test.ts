import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import {
	BLUA32_SYMBOLS_VERSION,
	blua32InlineCallSitesAtPc,
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
			globalNames: [],
			systemGlobalNames: [],
			staticFunctionIdBySlot: {},
			debugRanges: [innerCallRange, null],
			debugInlineCallSiteChains: [[], inlineCallSites],
			debugInlineCallSiteChainIds: [1, 0],
			statementPointsByFunction: [],
			resumePointsByFunction: [],
			localSlotsByFunction: [],
			upvalueNamesByFunction: [],
		},
	};

	const decoded = decodeBlua32SymbolsImage(encodeBlua32SymbolsImage(symbols));
	assert.deepEqual(decoded.metadata.functionDisplayNames, ['invoke']);
	assert.deepEqual(decoded.metadata.debugInlineCallSiteChains, [[], inlineCallSites]);
	assert.deepEqual(decoded.metadata.debugInlineCallSiteChainIds, [1, 0]);
	assert.deepEqual(blua32InlineCallSitesAtPc(decoded, 0x2000, 0x2000), inlineCallSites);
	assert.deepEqual(blua32InlineCallSitesAtPc(decoded, 0x2000, 0x2000 + INSTRUCTION_BYTES), []);
});
