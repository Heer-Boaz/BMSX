import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	BASE_BX_BITS,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	MAX_EXT_BX,
	MAX_LOW_BX,
	readInstructionWord,
	writeInstruction,
} from '../../../machine/ts/spec/blua32/instruction_format';
import {
	Blua32ConstantTag,
	BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_CONSTANT_RECORD_SIZE,
	BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET,
	BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_ALIGNMENT,
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_FUNCTION_RECORD_SIZE,
	BLUA32_FUNCTION_STATIC,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_VARARG,
	BLUA32_GLOBAL_NAME_ADDRESS_OFFSET,
	BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET,
	BLUA32_GLOBAL_NAME_RECORD_SIZE,
	BLUA32_IMAGE_BSS_ADDRESS_OFFSET,
	BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_DATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET,
	BLUA32_IMAGE_FLAGS_OFFSET,
	BLUA32_IMAGE_FUNCTION_COUNT_OFFSET,
	BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_HEADER_SIZE,
	BLUA32_IMAGE_MAGIC,
	BLUA32_IMAGE_MAGIC_OFFSET,
	BLUA32_IMAGE_RODATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_STRING_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_VERSION,
	BLUA32_IMAGE_VERSION_OFFSET,
	BLUA32_UPVALUE_IN_STACK_MASK,
	BLUA32_UPVALUE_RECORD_SIZE,
} from '../../../machine/ts/spec/blua32/image_format';
import {
	decodeBlua32Image,
	type Blua32ImageLayout,
} from './blua32_image';
import {
	BLUA32_SYMBOLS_VERSION,
	type Blua32DebugMetadata,
	type Blua32InlineCallSite,
	type Blua32ModuleFunction,
	type Blua32StaticLayoutToken,
	type Blua32SymbolsImage,
} from './blua32_symbols';
import type {
	ProgramBssSymbol,
	ProgramBiosFunctionConstReloc,
	ProgramConstValueReloc,
	ProgramCartObjectImage,
	ProgramDataSymbol,
	ProgramRodataSymbol,
	ProgramStorageSymbol,
	ProgramImageConstReloc,
	ProgramSystemObjectImage,
} from '../lua/compiler/program_object';
import type {
	ProgramMetadata,
	ProgramInitParticipant,
	ProgramRuntimeSymbols,
} from '../lua/compiler/program';
import { programModuleExportKey } from '../lua/compiler/program';
import { DYNAMIC_RAM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { fmix32 } from '../../../machine/ts/common/hash';
import { hashText } from '../../../machine/ts/common/byte_hex_string';
import { hashAssetId } from '../../../machine/ts/rompack/tokens';
import type {
	Blua32BiosFunctionExport,
	Blua32BiosFunctionImport,
	Blua32BiosImports,
} from './blua32_bios_imports';
import { SYSTEM_BLUA32_FUNCTION_RECORD_CAPACITY } from './system';
import { evaluateProgramLinkValueExpression } from '../lua/compiler/compile_time_number';

export type LinkedBlua32ImageBase = {
	bytes: Uint8Array;
	layout: Blua32ImageLayout;
	symbols: Blua32SymbolsImage;
	startupFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
	initFunctionAddress: number;
};

export type LinkedCartBlua32Image = LinkedBlua32ImageBase & {
	domain: 'cart';
};

export type LinkedSystemBlua32Image = LinkedBlua32ImageBase & {
	domain: 'system';
	biosImports: Blua32BiosImports;
};

export type LinkedBlua32Image = LinkedCartBlua32Image | LinkedSystemBlua32Image;

export type Blua32LinkBaseline = {
	image: Blua32ImageLayout;
	symbols: Blua32SymbolsImage;
};

type ObjectConstant = null | boolean | number | string;

type FunctionRecordLayout = {
	protoIndexBySlot: number[];
	functionIds: string[];
	hasTombstones: boolean;
};

type GlobalNameLayout = {
	names: string[];
	slotByObjectSlot: Uint32Array;
};

type ImageBuildInputBase = {
	metadata: ProgramMetadata;
	loadAddress: number;
	dataAddress: number;
	bssAddress: number;
	globalNames: ReadonlyArray<string>;
	systemGlobalNames: ReadonlyArray<string>;
	previous?: Blua32LinkBaseline;
};

type ImageBuildInput = ImageBuildInputBase & (
	| {
		domain: 'system';
		object: ProgramSystemObjectImage;
		biosExports: ReadonlyArray<Blua32BiosFunctionExport>;
	}
	| {
		domain: 'cart';
		object: ProgramCartObjectImage;
		biosImports: ReadonlyArray<Blua32BiosFunctionImport>;
	}
);

type StringRecord = {
	offset: number;
	bytes: Uint8Array;
};

const stringEncoder = new TextEncoder();

function inlineCallSiteChainsEqual(
	left: ReadonlyArray<Blua32InlineCallSite>,
	right: ReadonlyArray<Blua32InlineCallSite>,
): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		const leftSite = left[index];
		const rightSite = right[index];
		if (leftSite.calleeFunctionId !== rightSite.calleeFunctionId
			|| leftSite.callRange.path !== rightSite.callRange.path
			|| leftSite.callRange.start.line !== rightSite.callRange.start.line
			|| leftSite.callRange.start.column !== rightSite.callRange.start.column
			|| leftSite.callRange.end.line !== rightSite.callRange.end.line
			|| leftSite.callRange.end.column !== rightSite.callRange.end.column) {
			return false;
		}
	}
	return true;
}

function hashInlineCallSiteChain(
	chain: ReadonlyArray<Blua32InlineCallSite>,
	textHashes: Map<string, number>,
): number {
	let hash = fmix32(chain.length);
	for (let index = 0; index < chain.length; index += 1) {
		const callSite = chain[index];
		let functionHash = textHashes.get(callSite.calleeFunctionId);
		if (functionHash === undefined) {
			functionHash = hashText(callSite.calleeFunctionId);
			textHashes.set(callSite.calleeFunctionId, functionHash);
		}
		let pathHash = textHashes.get(callSite.callRange.path);
		if (pathHash === undefined) {
			pathHash = hashText(callSite.callRange.path);
			textHashes.set(callSite.callRange.path, pathHash);
		}
		hash = fmix32(hash ^ functionHash);
		hash = fmix32(hash ^ pathHash);
		hash = fmix32(hash ^ callSite.callRange.start.line);
		hash = fmix32(hash ^ callSite.callRange.start.column);
		hash = fmix32(hash ^ callSite.callRange.end.line);
		hash = fmix32(hash ^ callSite.callRange.end.column);
	}
	return hash;
}

function buildDebugInlineCallSiteTable(
	chainsByWord: ReadonlyArray<ReadonlyArray<Blua32InlineCallSite>>,
): Pick<Blua32DebugMetadata, 'debugInlineCallSiteChains' | 'debugInlineCallSiteChainIds'> {
	const rootChain: readonly [] = [];
	const debugInlineCallSiteChains: Array<ReadonlyArray<Blua32InlineCallSite>> = [rootChain];
	const debugInlineCallSiteChainIds = new Array<number>(chainsByWord.length);
	const chainIdByIdentity = new WeakMap<ReadonlyArray<Blua32InlineCallSite>, number>();
	const chainIdsByHash = new Map<number, number[]>();
	const textHashes = new Map<string, number>();
	for (let wordIndex = 0; wordIndex < chainsByWord.length; wordIndex += 1) {
		const chain = chainsByWord[wordIndex];
		if (chain.length === 0) {
			debugInlineCallSiteChainIds[wordIndex] = 0;
			continue;
		}
		let chainId = chainIdByIdentity.get(chain);
		if (chainId === undefined) {
			const hash = hashInlineCallSiteChain(chain, textHashes);
			const candidateIds = chainIdsByHash.get(hash);
			if (candidateIds !== undefined) {
				for (let index = 0; index < candidateIds.length; index += 1) {
					const candidateId = candidateIds[index];
					if (inlineCallSiteChainsEqual(chain, debugInlineCallSiteChains[candidateId])) {
						chainId = candidateId;
						break;
					}
				}
			}
			if (chainId === undefined) {
				chainId = debugInlineCallSiteChains.length;
				debugInlineCallSiteChains.push(chain);
				if (candidateIds === undefined) {
					chainIdsByHash.set(hash, [chainId]);
				} else {
					candidateIds.push(chainId);
				}
			}
			chainIdByIdentity.set(chain, chainId);
		}
		debugInlineCallSiteChainIds[wordIndex] = chainId;
	}
	return { debugInlineCallSiteChains, debugInlineCallSiteChainIds };
}

function alignImageOffset(offset: number, imageAddress: number, alignment: number): number {
	const address = imageAddress + offset;
	return ((address + alignment - 1) & ~(alignment - 1)) - imageAddress;
}

function assertStaticRamFits(baseAddress: number, byteCount: number, ramByteCount: number): void {
	const ramEndAddress = RAM_BASE + ramByteCount;
	if (baseAddress > ramEndAddress || byteCount > ramEndAddress - baseAddress) {
		throw new Error('BLua32 static storage exceeds RAM.');
	}
}

function mixStaticLayoutWord(token: Blua32StaticLayoutToken, value: number): void {
	const word = value >>> 0;
	token.lo = fmix32(token.lo ^ word);
	token.hi = fmix32(token.hi ^ word ^ token.lo);
}

function mixStaticLayoutSection(
	token: Blua32StaticLayoutToken,
	section: number,
	baseAddress: number,
	byteCount: number,
	symbols: ReadonlyArray<ProgramStorageSymbol>,
): void {
	mixStaticLayoutWord(token, section);
	mixStaticLayoutWord(token, baseAddress);
	mixStaticLayoutWord(token, byteCount);
	mixStaticLayoutWord(token, symbols.length);
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		const nameToken = hashAssetId(symbol.name);
		mixStaticLayoutWord(token, nameToken.lo);
		mixStaticLayoutWord(token, nameToken.hi);
		mixStaticLayoutWord(token, symbol.offset);
		mixStaticLayoutWord(token, symbol.byteCount);
		mixStaticLayoutWord(token, symbol.alignment);
	}
}

function buildStaticLayoutToken(
	rodataAddress: number,
	rodataByteCount: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	dataAddress: number,
	dataByteCount: number,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	bssAddress: number,
	bssByteCount: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	initParticipants: ReadonlyArray<ProgramInitParticipant>,
): Blua32StaticLayoutToken {
	const token = { lo: 0x84222325, hi: 0xcbf29ce4 };
	mixStaticLayoutSection(token, 1, rodataAddress, rodataByteCount, rodataSymbols);
	mixStaticLayoutSection(token, 2, dataAddress, dataByteCount, dataSymbols);
	mixStaticLayoutSection(token, 3, bssAddress, bssByteCount, bssSymbols);
	mixStaticLayoutWord(token, 4);
	mixStaticLayoutWord(token, initParticipants.length);
	for (let index = 0; index < initParticipants.length; index += 1) {
		const participant = initParticipants[index];
		const functionToken = hashAssetId(participant.functionId);
		const slotToken = hashAssetId(participant.slotName);
		mixStaticLayoutWord(token, functionToken.lo);
		mixStaticLayoutWord(token, functionToken.hi);
		mixStaticLayoutWord(token, slotToken.lo);
		mixStaticLayoutWord(token, slotToken.hi);
		mixStaticLayoutWord(token, participant.system ? 1 : 0);
	}
	return token;
}

function resolveStorageSymbolAddress(
	symbols: ReadonlyArray<ProgramBssSymbol | ProgramDataSymbol | ProgramRodataSymbol>,
	baseAddress: number,
	symbolName: string,
	addend: number,
): number {
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		if (symbol.name === symbolName) {
			return baseAddress + symbol.offset + addend;
		}
	}
	throw new Error(`BLua32 static symbol '${symbolName}' is undefined.`);
}

function resolveConstValueRelocation(
	reloc: ProgramConstValueReloc,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataAddress: number,
	dataLoadAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataAddress: number,
): number {
	switch (reloc.kind) {
		case 'data_addr':
			return resolveStorageSymbolAddress(dataSymbols, dataAddress, reloc.symbol, reloc.addend);
		case 'data_lma_addr':
			return resolveStorageSymbolAddress(dataSymbols, dataLoadAddress, reloc.symbol, reloc.addend);
		case 'bss_addr':
			return resolveStorageSymbolAddress(bssSymbols, bssAddress, reloc.symbol, reloc.addend);
		case 'rodata_addr':
			return resolveStorageSymbolAddress(rodataSymbols, rodataAddress, reloc.symbol, reloc.addend);
		case 'link_value':
			return evaluateProgramLinkValueExpression(reloc.expression);
	}
}

function resolveConstValues(
	constants: ReadonlyArray<ObjectConstant>,
	relocs: ReadonlyArray<ProgramConstValueReloc>,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataAddress: number,
	dataLoadAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataAddress: number,
): ObjectConstant[] {
	const resolved = constants.slice();
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		resolved[reloc.constIndex] = resolveConstValueRelocation(
			reloc,
			dataSymbols,
			dataAddress,
			dataLoadAddress,
			bssSymbols,
			bssAddress,
			rodataSymbols,
			rodataAddress,
		);
	}
	return resolved;
}

function rewriteResolvedABx(code: Uint8Array, wordIndex: number, op: OpCode, value: number): void {
	const word = readInstructionWord(code, wordIndex);
	const wideWord = readInstructionWord(code, wordIndex - 1);
	if (((wideWord >>> 18) & 0x3f) !== OpCode.WIDE) {
		throw new Error('Relocatable BLua32 ABx instruction has no WIDE word.');
	}
	const a = (word >>> 12) & 0x3f;
	const wideA = (wideWord >>> 12) & 0x3f;
	const wideC = wideWord & 0x3f;
	const wide = value >> BASE_BX_BITS;
	if (value > MAX_EXT_BX) {
		throw new Error('Relocated BLua32 ABx operand exceeds the instruction word.');
	}
	writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wide & 0x3f, wideC);
	writeInstruction(
		code,
		wordIndex,
		op,
		a,
		(value >>> 6) & 0x3f,
		value & MAX_LOW_BX,
		(value >> MAX_BX_BITS) & 0xff,
	);
}

function rewriteLocalClosures(code: Uint8Array, functionAddresses: ReadonlyArray<number>): void {
	const instructionCount = code.byteLength / INSTRUCTION_BYTES;
	for (let wordIndex = 1; wordIndex < instructionCount; wordIndex += 1) {
		const word = readInstructionWord(code, wordIndex);
		if (((word >>> 18) & 0x3f) !== OpCode.CLOSURE) {
			continue;
		}
		const wideWord = readInstructionWord(code, wordIndex - 1);
		if (((wideWord >>> 18) & 0x3f) !== OpCode.WIDE) {
			throw new Error('BLua32 closure instruction has no WIDE word.');
		}
		const functionIndex = (((wideWord >>> 6) & 0x3f) << BASE_BX_BITS)
			| ((word >>> 24) << MAX_BX_BITS)
			| (word & MAX_LOW_BX);
		rewriteResolvedABx(code, wordIndex, OpCode.CLOSURE, functionAddresses[functionIndex] >> 4);
	}
}

function functionAddressesById(ids: ReadonlyArray<string>, addresses: ReadonlyArray<number>): Map<string, number> {
	const addressById = new Map<string, number>();
	for (let index = 0; index < ids.length; index += 1) {
		addressById.set(ids[index], addresses[index]);
	}
	return addressById;
}

function moduleAddressesByPath(entries: ReadonlyArray<Blua32ModuleFunction>): Map<string, number> {
	const addresses = new Map<string, number>();
	for (let index = 0; index < entries.length; index += 1) {
		addresses.set(entries[index].path, entries[index].address);
	}
	return addresses;
}

function layoutFunctionRecords(
	functionIds: ReadonlyArray<string>,
	pinnedFunctionIds: ReadonlyArray<string> | undefined,
	previous?: Blua32LinkBaseline,
): FunctionRecordLayout {
	const protoIndexById = new Map<string, number>();
	for (let protoIndex = 0; protoIndex < functionIds.length; protoIndex += 1) {
		protoIndexById.set(functionIds[protoIndex], protoIndex);
	}
	const pinnedFunctionCount = pinnedFunctionIds ? pinnedFunctionIds.length : 0;
	const protoIndexBySlot = new Array<number>(pinnedFunctionCount);
	const assigned = new Uint8Array(functionIds.length);
	let hasTombstones = false;
	if (pinnedFunctionIds) {
		for (let slot = 0; slot < pinnedFunctionCount; slot += 1) {
			const protoIndex = protoIndexById.get(pinnedFunctionIds[slot]);
			if (protoIndex === undefined) {
				throw new Error(`BLua32 pinned function '${pinnedFunctionIds[slot]}' is undefined.`);
			}
			protoIndexBySlot[slot] = protoIndex;
			assigned[protoIndex] = 1;
		}
	}

	if (previous) {
		const previousIds = previous.symbols.metadata.functionIds;
		for (let slot = pinnedFunctionCount; slot < previousIds.length; slot += 1) {
			const protoIndex = protoIndexById.get(previousIds[slot]);
			if (protoIndex === undefined) {
				protoIndexBySlot.push(-1);
				hasTombstones = true;
				continue;
			}
			protoIndexBySlot.push(protoIndex);
			assigned[protoIndex] = 1;
		}
	}

	for (let protoIndex = 0; protoIndex < functionIds.length; protoIndex += 1) {
		if (assigned[protoIndex] !== 0) {
			continue;
		}
		protoIndexBySlot.push(protoIndex);
	}

	const orderedFunctionIds = new Array<string>(protoIndexBySlot.length);
	for (let slot = 0; slot < protoIndexBySlot.length; slot += 1) {
		const protoIndex = protoIndexBySlot[slot];
		orderedFunctionIds[slot] = protoIndex < 0
			? previous!.symbols.metadata.functionIds[slot]
			: functionIds[protoIndex];
	}
	return {
		protoIndexBySlot,
		functionIds: orderedFunctionIds,
		hasTombstones,
	};
}

function resolvePinnedBiosFunctionIds(
	exports: ReadonlyArray<Blua32BiosFunctionExport>,
	moduleExports: ReadonlyArray<{ path: string; exportPathKey: string; slotName: string }>,
	localSymbols: ProgramRuntimeSymbols,
): string[] {
	const slotBySymbol = new Map<string, string>();
	for (let index = 0; index < moduleExports.length; index += 1) {
		const entry = moduleExports[index];
		slotBySymbol.set(programModuleExportKey(entry.path, entry.exportPathKey), entry.slotName);
	}
	const ids = new Array<string>(exports.length);
	for (let index = 0; index < exports.length; index += 1) {
		const entry = exports[index];
		const target = `${entry.path}:${entry.exportPathKey}`;
		const slotName = slotBySymbol.get(programModuleExportKey(entry.path, entry.exportPathKey));
		if (slotName === undefined) {
			throw new Error(`BIOS public function target '${target}' is not exported by the system program.`);
		}
		const functionId = localSymbols.exportProtoIdBySlot[slotName];
		if (functionId === undefined) {
			throw new Error(`BIOS public function target '${target}' is not a static function export.`);
		}
		ids[index] = functionId;
	}
	return ids;
}

function localFunctionAddressesBySymbol(
	moduleExports: ReadonlyArray<{ path: string; exportPathKey: string; slotName: string }>,
	localSymbols: ProgramRuntimeSymbols,
	localFunctionAddressById: ReadonlyMap<string, number>,
): Map<string, number> {
	const addresses = new Map<string, number>();
	for (let index = 0; index < moduleExports.length; index += 1) {
		const entry = moduleExports[index];
		const functionId = localSymbols.exportProtoIdBySlot[entry.slotName];
		if (functionId === undefined) {
			continue;
		}
		const address = localFunctionAddressById.get(functionId);
		if (address === undefined) {
			throw new Error(`BLua32 static function '${entry.path}:${entry.exportPathKey}' has no function record.`);
		}
		addresses.set(
			programModuleExportKey(entry.path, entry.exportPathKey),
			address,
		);
	}
	return addresses;
}

function rewriteImageRelocation(
	code: Uint8Array,
	reloc: ProgramImageConstReloc,
	localFunctionAddressBySymbol: ReadonlyMap<string, number>,
	localModuleAddressByPath: ReadonlyMap<string, number>,
	globalSlotByObjectSlot: Uint32Array,
	systemGlobalSlotByObjectSlot: Uint32Array,
): void {
	switch (reloc.kind) {
		case 'gl':
		case 'sys': {
			const word = readInstructionWord(code, reloc.wordIndex);
			rewriteResolvedABx(
				code,
				reloc.wordIndex,
				((word >>> 18) & 0x3f) as OpCode,
				reloc.kind === 'gl'
					? globalSlotByObjectSlot[reloc.objectSlot]
					: systemGlobalSlotByObjectSlot[reloc.objectSlot],
			);
			break;
		}
		case 'export_proto': {
			const symbol = `${reloc.path}:${reloc.exportPathKey}`;
			const address = localFunctionAddressBySymbol.get(programModuleExportKey(reloc.path, reloc.exportPathKey));
			if (address === undefined) {
				throw new Error(`BLua32 function symbol '${symbol}' is not part of this executable image.`);
			}
			rewriteResolvedABx(code, reloc.wordIndex, OpCode.CLOSURE, address >> 4);
			break;
		}
		case 'module_init': {
			const localAddress = localModuleAddressByPath.get(reloc.symbol);
			if (localAddress === undefined) {
				throw new Error(`BLua32 module initializer '${reloc.symbol}' is not part of this executable image.`);
			}
			rewriteResolvedABx(code, reloc.wordIndex, OpCode.CLOSURE, localAddress >> 4);
			break;
		}
	}
}

function rewriteImageRelocations(
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramImageConstReloc>,
	localFunctionAddressBySymbol: ReadonlyMap<string, number>,
	localModuleAddressByPath: ReadonlyMap<string, number>,
	globalSlotByObjectSlot: Uint32Array,
	systemGlobalSlotByObjectSlot: Uint32Array,
): void {
	for (let index = 0; index < relocs.length; index += 1) {
		rewriteImageRelocation(
			code,
			relocs[index],
			localFunctionAddressBySymbol,
			localModuleAddressByPath,
			globalSlotByObjectSlot,
			systemGlobalSlotByObjectSlot,
		);
	}
}

function layoutGlobalNames(
	objectNames: ReadonlyArray<string>,
	previousNames: ReadonlyArray<string> | undefined,
): GlobalNameLayout {
	const names = previousNames ? Array.from(previousNames) : [];
	const slotByName = new Map<string, number>();
	for (let slot = 0; slot < names.length; slot += 1) {
		slotByName.set(names[slot], slot);
	}
	const slotByObjectSlot = new Uint32Array(objectNames.length);
	for (let objectSlot = 0; objectSlot < objectNames.length; objectSlot += 1) {
		const name = objectNames[objectSlot];
		let slot = slotByName.get(name);
		if (slot === undefined) {
			slot = names.length;
			names.push(name);
			slotByName.set(name, slot);
		}
		slotByObjectSlot[objectSlot] = slot;
	}
	return { names, slotByObjectSlot };
}

function rewriteBiosFunctionRelocations(
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramBiosFunctionConstReloc>,
	imports: ReadonlyArray<Blua32BiosFunctionImport>,
): void {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		rewriteResolvedABx(
			code,
			reloc.wordIndex,
			OpCode.CLOSURE,
			imports[reloc.importIndex].functionAddress >> 4,
		);
	}
}

function buildImage(input: ImageBuildInput & { domain: 'system' }): LinkedSystemBlua32Image;
function buildImage(input: ImageBuildInput & { domain: 'cart' }): LinkedCartBlua32Image;
function buildImage(input: ImageBuildInput): LinkedBlua32Image {
	const object = input.object;
	const text = object.sections.text;
	const rodata = object.sections.rodata;
	const data = object.sections.data;
	const bss = object.sections.bss;
	const globalNameLayout = layoutGlobalNames(
		input.globalNames,
		input.previous?.image.globalNames,
	);
	const systemGlobalNameLayout = layoutGlobalNames(
		input.systemGlobalNames,
		input.previous?.image.systemGlobalNames,
	);
	const initFunctionId = object.vectors.initProtoIndex === null
		? null
		: input.metadata.protoIds[object.vectors.initProtoIndex];
	let pinnedFunctionIds: string[] | undefined;
	if (input.domain === 'system') {
		pinnedFunctionIds = resolvePinnedBiosFunctionIds(
			input.biosExports,
			rodata.moduleExports,
			object.link.symbols,
		);
		if (initFunctionId !== null) {
			pinnedFunctionIds.push(initFunctionId);
		}
	} else if (initFunctionId !== null) {
		pinnedFunctionIds = [initFunctionId];
	}
	const functionLayout = layoutFunctionRecords(input.metadata.protoIds, pinnedFunctionIds, input.previous);
	const functionCount = functionLayout.protoIndexBySlot.length;
	const textByteCount = text.code.byteLength + (functionLayout.hasTombstones ? INSTRUCTION_BYTES : 0);

	let offset = BLUA32_IMAGE_HEADER_SIZE;
	let rodataOffset = 0;
	let dataLoadOffset = 0;
	if (input.domain === 'cart') {
		rodataOffset = alignImageOffset(offset, input.loadAddress, 4);
		offset = rodataOffset + rodata.bytes.byteLength;
		dataLoadOffset = alignImageOffset(offset, input.loadAddress, 4);
		offset = dataLoadOffset + data.bytes.byteLength;
	}
	const functionTableOffset = alignImageOffset(offset, input.loadAddress, BLUA32_FUNCTION_ALIGNMENT);
	if (input.domain === 'system') {
		if (functionCount > SYSTEM_BLUA32_FUNCTION_RECORD_CAPACITY) {
			throw new Error(
				`System BLua32 function count ${functionCount} exceeds `
				+ `the ${SYSTEM_BLUA32_FUNCTION_RECORD_CAPACITY}-record system table.`,
			);
		}
		offset = functionTableOffset
			+ SYSTEM_BLUA32_FUNCTION_RECORD_CAPACITY * BLUA32_FUNCTION_RECORD_SIZE;
		rodataOffset = alignImageOffset(offset, input.loadAddress, 4);
		offset = rodataOffset + rodata.bytes.byteLength;
		dataLoadOffset = alignImageOffset(offset, input.loadAddress, 4);
		offset = dataLoadOffset + data.bytes.byteLength;
	} else {
		offset = functionTableOffset + functionCount * BLUA32_FUNCTION_RECORD_SIZE;
	}
	const upvalueTableOffset = alignImageOffset(
		offset,
		input.loadAddress,
		BLUA32_UPVALUE_RECORD_SIZE,
	);
	let upvalueByteCount = 0;
	for (let slot = 0; slot < functionCount; slot += 1) {
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		const upvalueCount = protoIndex < 0
			? input.previous!.image.functions[slot].upvalues.length
			: text.protos[protoIndex].upvalueDescs.length;
		upvalueByteCount += upvalueCount * BLUA32_UPVALUE_RECORD_SIZE;
	}
	offset = upvalueTableOffset + upvalueByteCount;
	const constantTableOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = constantTableOffset + rodata.constPool.length * BLUA32_CONSTANT_RECORD_SIZE;
	const globalNameTableOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = globalNameTableOffset + globalNameLayout.names.length * BLUA32_GLOBAL_NAME_RECORD_SIZE;
	const systemGlobalNameTableOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = systemGlobalNameTableOffset + systemGlobalNameLayout.names.length * BLUA32_GLOBAL_NAME_RECORD_SIZE;

	const stringRecordByValue = new Map<string, StringRecord>();
	const stringRecords: StringRecord[] = [];
	let stringByteCount = 0;
	const internString = (value: string): StringRecord => {
		const existing = stringRecordByValue.get(value);
		if (existing !== undefined) {
			return existing;
		}
		const record = { offset: stringByteCount, bytes: stringEncoder.encode(value) };
		stringByteCount += record.bytes.byteLength;
		stringRecordByValue.set(value, record);
		stringRecords.push(record);
		return record;
	};
	for (let index = 0; index < rodata.constPool.length; index += 1) {
		const value = rodata.constPool[index];
		if (typeof value === 'string') {
			internString(value);
		}
	}
	for (let index = 0; index < globalNameLayout.names.length; index += 1) {
		internString(globalNameLayout.names[index]);
	}
	for (let index = 0; index < systemGlobalNameLayout.names.length; index += 1) {
		internString(systemGlobalNameLayout.names[index]);
	}

	const stringTableOffset = offset;
	offset += stringByteCount;
	const textOffset = alignImageOffset(offset, input.loadAddress, INSTRUCTION_BYTES);
	const imageByteCount = textOffset + textByteCount;

	const functionTableAddress = input.loadAddress + functionTableOffset;
	const functionAddresses = new Array<number>(functionCount);
	const functionAddressByProtoIndex = new Array<number>(text.protos.length);
	for (let slot = 0; slot < functionCount; slot += 1) {
		const address = functionTableAddress + slot * BLUA32_FUNCTION_RECORD_SIZE;
		functionAddresses[slot] = address;
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		if (protoIndex >= 0) {
			functionAddressByProtoIndex[protoIndex] = address;
		}
	}
	const moduleFunctions = new Array<Blua32ModuleFunction>(rodata.moduleProtos.length);
	for (let index = 0; index < moduleFunctions.length; index += 1) {
		const entry = rodata.moduleProtos[index];
		moduleFunctions[index] = { path: entry.path, address: functionAddressByProtoIndex[entry.protoIndex] };
	}
	const localFunctionAddressById = functionAddressesById(
		object.link.symbols.protoIds,
		functionAddressByProtoIndex,
	);
	const localFunctionAddressBySymbol = localFunctionAddressesBySymbol(
		rodata.moduleExports,
		object.link.symbols,
		localFunctionAddressById,
	);
	const localModuleAddressByPath = moduleAddressesByPath(moduleFunctions);

	const code = new Uint8Array(textByteCount);
	code.set(text.code);
	if (functionLayout.hasTombstones) {
		writeInstruction(code, text.code.byteLength / INSTRUCTION_BYTES, OpCode.WIDE, 0, 0, 0);
	}
	rewriteLocalClosures(code, functionAddressByProtoIndex);
	rewriteImageRelocations(
		code,
		input.object.link.constRelocs,
		localFunctionAddressBySymbol,
		localModuleAddressByPath,
		globalNameLayout.slotByObjectSlot,
		systemGlobalNameLayout.slotByObjectSlot,
	);
	if (input.domain === 'cart') {
		rewriteBiosFunctionRelocations(
			code,
			input.object.link.biosFunctionConstRelocs,
			input.biosImports,
		);
	}

	const rodataAddress = input.loadAddress + rodataOffset;
	const dataLoadAddress = input.loadAddress + dataLoadOffset;
	const constants = resolveConstValues(
		rodata.constPool,
		object.link.constValueRelocs,
		data.symbols,
		input.dataAddress,
		dataLoadAddress,
		bss.symbols,
		input.bssAddress,
		rodata.symbols,
		rodataAddress,
	);
	const rodataBytes = rodata.bytes.slice();
	for (let index = 0; index < object.link.rodataConstRelocs.length; index += 1) {
		const reloc = object.link.rodataConstRelocs[index];
		writeLE32(rodataBytes, reloc.byteOffset, reloc.constIndex);
	}

	const bytes = new Uint8Array(imageByteCount);
	writeLE32(bytes, BLUA32_IMAGE_MAGIC_OFFSET, BLUA32_IMAGE_MAGIC);
	writeLE32(bytes, BLUA32_IMAGE_VERSION_OFFSET, BLUA32_IMAGE_VERSION);
	writeLE32(bytes, BLUA32_IMAGE_BYTE_COUNT_OFFSET, imageByteCount);
	writeLE32(bytes, BLUA32_IMAGE_FLAGS_OFFSET, 0);
	writeLE32(bytes, BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET, functionTableAddress);
	writeLE32(bytes, BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, functionCount);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET, input.loadAddress + constantTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, constants.length);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, input.loadAddress + globalNameTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, globalNameLayout.names.length);
	writeLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, input.loadAddress + systemGlobalNameTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET, systemGlobalNameLayout.names.length);
	writeLE32(bytes, BLUA32_IMAGE_STRING_ADDRESS_OFFSET, input.loadAddress + stringTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_STRING_BYTE_COUNT_OFFSET, stringByteCount);
	writeLE32(bytes, BLUA32_IMAGE_RODATA_ADDRESS_OFFSET, rodataAddress);
	writeLE32(bytes, BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET, rodataBytes.byteLength);
	writeLE32(bytes, BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET, dataLoadAddress);
	writeLE32(bytes, BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET, data.bytes.byteLength);
	writeLE32(bytes, BLUA32_IMAGE_DATA_ADDRESS_OFFSET, input.dataAddress);
	writeLE32(bytes, BLUA32_IMAGE_BSS_ADDRESS_OFFSET, input.bssAddress);
	writeLE32(bytes, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, bss.byteCount);
	writeLE32(bytes, BLUA32_IMAGE_TEXT_ADDRESS_OFFSET, input.loadAddress + textOffset);
	writeLE32(bytes, BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET, code.byteLength);

	let upvalueOffset = upvalueTableOffset;
	for (let slot = 0; slot < functionCount; slot += 1) {
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		const currentProto = protoIndex < 0 ? null : text.protos[protoIndex];
		const record = currentProto === null
			? input.previous!.image.functions[slot]
			: currentProto;
		const upvalues = currentProto === null
			? input.previous!.image.functions[slot].upvalues
			: currentProto.upvalueDescs;
		const recordOffset = functionTableOffset + slot * BLUA32_FUNCTION_RECORD_SIZE;
		writeLE32(
			bytes,
			recordOffset + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
			currentProto === null
				? input.loadAddress + textOffset + text.code.byteLength
				: input.loadAddress + textOffset + currentProto.entryPC,
		);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, currentProto === null ? INSTRUCTION_BYTES : currentProto.codeLen);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_NUM_PARAMS_OFFSET, record.numParams);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_MAX_STACK_OFFSET, record.maxStack);
		writeLE32(
			bytes,
			recordOffset + BLUA32_FUNCTION_FLAGS_OFFSET,
			(record.isVararg ? BLUA32_FUNCTION_VARARG : 0)
				| (record.staticClosure ? BLUA32_FUNCTION_STATIC : 0),
		);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, input.loadAddress + upvalueOffset);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, upvalues.length);
		for (let upvalueIndex = 0; upvalueIndex < upvalues.length; upvalueIndex += 1) {
			const upvalue = upvalues[upvalueIndex];
			writeLE32(bytes, upvalueOffset, (upvalue.inStack ? BLUA32_UPVALUE_IN_STACK_MASK : 0) | upvalue.index);
			upvalueOffset += BLUA32_UPVALUE_RECORD_SIZE;
		}
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const stringAddress = input.loadAddress + stringTableOffset;
	for (let index = 0; index < constants.length; index += 1) {
		const value = constants[index];
		const recordOffset = constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		if (value === null) {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.Nil);
		} else if (value === false) {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.False);
		} else if (value === true) {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.True);
		} else if (typeof value === 'string') {
			const stringRecord = stringRecordByValue.get(value) as StringRecord;
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.String);
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET, stringAddress + stringRecord.offset);
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET, stringRecord.bytes.byteLength);
		} else {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.Number);
			view.setFloat64(recordOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET, value, true);
		}
	}

	const writeNames = (tableOffset: number, names: ReadonlyArray<string>): void => {
		for (let index = 0; index < names.length; index += 1) {
			const stringRecord = stringRecordByValue.get(names[index]) as StringRecord;
			const recordOffset = tableOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			writeLE32(bytes, recordOffset + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET, stringAddress + stringRecord.offset);
			writeLE32(bytes, recordOffset + BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET, stringRecord.bytes.byteLength);
		}
	};
	writeNames(globalNameTableOffset, globalNameLayout.names);
	writeNames(systemGlobalNameTableOffset, systemGlobalNameLayout.names);
	for (let index = 0; index < stringRecords.length; index += 1) {
		const record = stringRecords[index];
		bytes.set(record.bytes, stringTableOffset + record.offset);
	}
	bytes.set(rodataBytes, rodataOffset);
	bytes.set(data.bytes, dataLoadOffset);
	bytes.set(code, textOffset);

	const staticLayoutToken = buildStaticLayoutToken(
		rodataAddress,
		rodataBytes.byteLength,
		rodata.symbols,
		input.dataAddress,
		data.bytes.byteLength,
		data.symbols,
		input.bssAddress,
		bss.byteCount,
		bss.symbols,
		object.link.symbols.initParticipants,
	);
	const statementPointsByFunction = new Array<Blua32DebugMetadata['statementPointsByFunction'][number]>(functionCount);
	const resumePointsByFunction = new Array<Blua32DebugMetadata['resumePointsByFunction'][number]>(functionCount);
	const localSlotsByFunction = new Array<Blua32DebugMetadata['localSlotsByFunction'][number]>(functionCount);
	const upvalueNamesByFunction = new Array<Blua32DebugMetadata['upvalueNamesByFunction'][number]>(functionCount);
	const noDebugRecords: readonly [] = [];
	for (let slot = 0; slot < functionCount; slot += 1) {
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		if (protoIndex < 0) {
			statementPointsByFunction[slot] = noDebugRecords;
			resumePointsByFunction[slot] = noDebugRecords;
			localSlotsByFunction[slot] = noDebugRecords;
			upvalueNamesByFunction[slot]
				= input.previous!.symbols.metadata.upvalueNamesByFunction[slot];
			continue;
		}
		statementPointsByFunction[slot] = input.metadata.statementPointsByProto[protoIndex];
		resumePointsByFunction[slot] = input.metadata.resumePointsByProto[protoIndex];
		localSlotsByFunction[slot] = input.metadata.localSlotsByProto[protoIndex];
		upvalueNamesByFunction[slot] = input.metadata.upvalueNamesByProto[protoIndex];
	}
	const debugInlineCallSiteTable = buildDebugInlineCallSiteTable(
		input.metadata.debugInlineCallSites,
	);
	const metadata: Blua32DebugMetadata = {
		functionIds: functionLayout.functionIds,
		globalNames: globalNameLayout.names,
		systemGlobalNames: systemGlobalNameLayout.names,
		staticFunctionIdBySlot: input.metadata.exportProtoIdBySlot,
		debugRanges: functionLayout.hasTombstones
			? [...input.metadata.debugRanges, null]
			: input.metadata.debugRanges,
		debugInlineCallSiteChains: debugInlineCallSiteTable.debugInlineCallSiteChains,
		debugInlineCallSiteChainIds: functionLayout.hasTombstones
			? [...debugInlineCallSiteTable.debugInlineCallSiteChainIds, 0]
			: debugInlineCallSiteTable.debugInlineCallSiteChainIds,
		statementPointsByFunction,
		resumePointsByFunction,
		localSlotsByFunction,
		upvalueNamesByFunction,
	};
	const symbols: Blua32SymbolsImage = {
		version: BLUA32_SYMBOLS_VERSION,
		imageAddress: input.loadAddress,
		functionAddresses,
		moduleFunctions,
		initFunctionAddress: object.vectors.initProtoIndex === null
			? 0
			: functionAddressByProtoIndex[object.vectors.initProtoIndex],
		initParticipants: object.link.symbols.initParticipants,
		staticLayoutToken,
		metadata,
	};
	const layout = decodeBlua32Image(bytes, input.loadAddress);
	if (input.domain === 'system') {
		return {
			domain: 'system',
			bytes,
			layout,
			symbols,
			biosImports: {
				cartridgeStaticRamBase: input.bssAddress + bss.byteCount,
				functions: input.biosExports.map((entry, index) => ({
					path: entry.path,
					exportPathKey: entry.exportPathKey,
					functionAddress: functionAddresses[index],
				})),
			},
			startupFunctionAddress: functionAddressByProtoIndex[object.vectors.resetProtoIndex],
			irqFunctionAddress: functionAddressByProtoIndex[object.vectors.irqProtoIndex],
			exceptionFunctionAddress: functionAddressByProtoIndex[object.vectors.exceptionProtoIndex],
			initFunctionAddress: symbols.initFunctionAddress,
		};
	}
	return {
		domain: 'cart',
		bytes,
		layout,
		symbols,
		startupFunctionAddress: functionAddressByProtoIndex[object.vectors.resetProtoIndex],
		irqFunctionAddress: functionAddressByProtoIndex[object.vectors.irqProtoIndex],
		exceptionFunctionAddress: functionAddressByProtoIndex[object.vectors.exceptionProtoIndex],
		initFunctionAddress: symbols.initFunctionAddress,
	};
}

export function linkSystemBlua32Image(
	object: ProgramSystemObjectImage,
	metadata: ProgramMetadata,
	loadAddress: number,
	ramByteCount: number,
	biosExports: ReadonlyArray<Blua32BiosFunctionExport>,
	previous?: Blua32LinkBaseline,
): LinkedSystemBlua32Image {
	const dataAddress = DYNAMIC_RAM_BASE;
	const bssAddress = dataAddress + object.sections.data.bytes.byteLength;
	assertStaticRamFits(
		dataAddress,
		object.sections.data.bytes.byteLength + object.sections.bss.byteCount,
		ramByteCount,
	);
	return buildImage({
		domain: 'system',
		object,
		metadata,
		loadAddress,
		dataAddress,
		bssAddress,
		globalNames: object.link.symbols.globalNames,
		systemGlobalNames: object.link.symbols.systemGlobalNames,
		biosExports,
		previous,
	});
}

export function linkCartBlua32Image(
	biosImports: Blua32BiosImports,
	object: ProgramCartObjectImage,
	metadata: ProgramMetadata,
	loadAddress: number,
	ramByteCount: number,
	previous?: Blua32LinkBaseline,
): LinkedCartBlua32Image {
	const dataAddress = biosImports.cartridgeStaticRamBase;
	const bssAddress = dataAddress + object.sections.data.bytes.byteLength;
	assertStaticRamFits(
		DYNAMIC_RAM_BASE,
		bssAddress + object.sections.bss.byteCount - DYNAMIC_RAM_BASE,
		ramByteCount,
	);
	return buildImage({
		domain: 'cart',
		object,
		metadata,
		loadAddress,
		dataAddress,
		bssAddress,
		globalNames: object.link.symbols.globalNames,
		systemGlobalNames: object.link.symbols.systemGlobalNames,
		biosImports: biosImports.functions,
		previous,
	});
}

export function applyBlua32LinkValues(
	linked: LinkedBlua32Image,
	relocs: ReadonlyArray<ProgramConstValueReloc>,
	modulePath: string,
	values: ReadonlyMap<string, number>,
): void {
	const constantTableOffset = linked.layout.header.constantTableAddress - linked.layout.address;
	const view = new DataView(
		linked.bytes.buffer,
		linked.bytes.byteOffset,
		linked.bytes.byteLength,
	);
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		if (reloc.kind !== 'link_value' || reloc.modulePath !== modulePath) {
			continue;
		}
		const value = evaluateProgramLinkValueExpression(reloc.expression, values);
		view.setFloat64(
			constantTableOffset
				+ reloc.constIndex * BLUA32_CONSTANT_RECORD_SIZE
				+ BLUA32_CONSTANT_PAYLOAD_OFFSET,
			value,
			true,
		);
		linked.layout.constants[reloc.constIndex] = value;
	}
}
