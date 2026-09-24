import { CapturedLocalKind } from '../../toolchain/ts/lua/compiler/capture_kind';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import {
	blua32InlineCallSitesAtPc,
	blua32SlotLiveAtPc,
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
		imageAddress: 0x1000,
		functionAddresses: [],
		moduleFunctions: [],
		initFunctionAddress: 0,
		initParticipants: [],
		staticLayoutToken: { lo: 0, hi: 0 },
		metadata: {
			traceStatements: ['fixture.compile', 'fixture.bind'],
			preloadModules: ['fixture/observer'],
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
			resumePointsByFunction: [[
				{ wordOffset: 3, range: innerCallRange, op: OpCode.MOV, liveRegisters: [0, 1], uses: [0], defs: [1], inlineCallSites },
				{ wordOffset: 4, range: innerCallRange, op: OpCode.RET, liveRegisters: [0], uses: [0], defs: [], inlineCallSites: [], resumeId: 'startup.entry.return' },
			]],
			localSlotsByFunction: [[{ name: 'value', isConst: true, registerIndex: 1, definition: innerCallRange,
				scope: outerCallRange, inlineCallSites, liveWordRanges: [{ start: 2, end: 4 }, { start: 6, end: 8 }] }]],
			captureSlotsByFunction: [[
				{ captureIndex: 0, location: { inStack: true, index: 17 }, inlineCallSites, liveWordRanges: [{ start: 2, end: 4 }] },
				{ captureIndex: 0, location: { inStack: false, index: 0 }, inlineCallSites: [], liveWordRanges: [{ start: 0, end: 8 }] },
				{ captureIndex: 0, location: null, inlineCallSites, liveWordRanges: [] },
			]],
			capturedLocals: [{
				kind: CapturedLocalKind.Local,
				isConst: true,
				functionId: 'module:cart/module', name: 'value',
				definition: innerCallRange,
			}],
			upvalueBindingsByFunction: [[0]],
		},
	};

	const decoded = decodeBlua32SymbolsImage(encodeBlua32SymbolsImage(symbols));
	assert.equal(Object.hasOwn(decoded, 'version'), false, 'symbols carry the current structure without a schema version');
	assert.deepEqual(decoded.metadata.traceStatements, ['fixture.compile', 'fixture.bind']);
	assert.deepEqual(decoded.metadata.preloadModules, ['fixture/observer']);
	for (const traceStatements of ['erase', 'emit', []] as const) {
		const metadata = { ...symbols.metadata, traceStatements };
		assert.deepEqual(decodeBlua32SymbolsImage(encodeBlua32SymbolsImage({ ...symbols, metadata })).metadata, metadata);
	}
	assert.deepEqual(decoded.metadata.localSlotsByFunction, symbols.metadata.localSlotsByFunction);
	for (const isConst of [false, true]) {
		const metadata = { ...symbols.metadata,
			localSlotsByFunction: [[{ ...symbols.metadata.localSlotsByFunction[0][0], isConst }]],
			capturedLocals: [{ ...symbols.metadata.capturedLocals[0], isConst }] };
		assert.deepEqual(decodeBlua32SymbolsImage(encodeBlua32SymbolsImage({ ...symbols, metadata })).metadata, metadata);
	}
	assert.deepEqual(decoded.metadata.resumePointsByFunction, symbols.metadata.resumePointsByFunction);
	const slot = decoded.metadata.localSlotsByFunction[0][0];
	for (let word = 0; word <= 9; word += 1) {
		assert.equal(blua32SlotLiveAtPc(slot.liveWordRanges, 0x2000, 0x2000 + word * INSTRUCTION_BYTES),
			word >= 2 && word < 4 || word >= 6 && word < 8, 'word intervals are half-open with explicit gaps');
	}
	assert.equal(blua32SlotLiveAtPc([], 0x2000, 0x2000), false);
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
});
