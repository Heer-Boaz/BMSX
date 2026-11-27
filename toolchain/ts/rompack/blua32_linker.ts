import { textToByteString } from '../../../machine/ts/common/byte_string';
import { integerConstant, type NumberConstant } from '../lua/number';
import type { ProgramConstant } from '../lua/compiler/program';
import { inlineCallSiteChainsEqual } from '../lua/compiler/inline_debug';
import { LexicalDeclarationKind, StaticDeclarationKind } from '../lua/compiler/declaration_kind';
import type { SourceRange } from '../lua/source_range';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	BASE_BX_BITS,
	CLOSURE_ADDRESS_REGISTER_WIDE_C,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	MAX_EXT_BX,
	MAX_LOW_BX,
	MAX_LOW_OPERAND,
	MAX_OPERAND_BITS,
	ValueMoveKind,
	readInstructionWord,
	writeInstruction,
} from '../../../machine/ts/spec/blua32/instruction_format';
import {
	Blua32ConstantTag,
	BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_CONSTANT_RECORD_SIZE,
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
	BLUA32_IMAGE_INIT_FUNCTION_ADDRESS_OFFSET,
	BLUA32_IMAGE_MAGIC,
	BLUA32_IMAGE_MAGIC_OFFSET,
	BLUA32_IMAGE_RODATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET,
	BLUA32_UPVALUE_IN_STACK_MASK,
	BLUA32_UPVALUE_RECORD_SIZE,
} from '../../../machine/ts/spec/blua32/image_format';
import {
	alignBlua32ImageOffset,
	decodeBlua32Image,
	type Blua32ImageLayout,
} from './blua32_image';
import {
	type Blua32LexicalDeclarationDebug,
	type Blua32DebugMetadata,
	type Blua32InlineCallSite,
	type Blua32ModuleFunction,
	type Blua32StaticLayoutToken,
	type Blua32StaticDeclarationDebug,
	type Blua32SymbolsImage,
} from './blua32_symbols';
import type { LuaSourceCorrespondence } from '../lua/semantic/source_correspondence';
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
import {
	HEAP_SERVICE_DESCRIPTOR_SIZE,
	HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, HEAP_SERVICE_IMAGE_FLAG, HEAP_SERVICE_IMAGE_HEADER_SIZE,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { fmix32, hashText } from '../../../machine/ts/common/hash';
import { Blua32RomStringLayout } from './blua32_rom_strings';
import { hashAssetId } from '../../../machine/ts/rompack/tokens';
import type {
	Blua32BiosFunctionExport,
	Blua32BiosFunctionImport,
	Blua32BiosImports,
} from './blua32_bios_imports';
import { SYSTEM_BLUA32_FUNCTION_TABLE_ALIGNMENT } from './system';
import { evaluateProgramLinkValueExpression } from '../lua/compiler/compile_time_number';
import { HEAP_SERVICE_MODULE_PATH, linkBlua32HeapService } from './blua32_heap_service';

const RETIRED_FUNCTION_BYTES = 2 * INSTRUCTION_BYTES;

export type LinkedBlua32ImageBase = {
	bytes: Uint8Array;
	layout: Blua32ImageLayout;
	symbols: Blua32SymbolsImage;
	/** Current object proto per function slot; -1 is a retained tombstone. Tooling only. */
	functionProtoIndices: readonly number[];
	startupFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
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
	/** Live source correspondence for origins retained by removed functions. */
	captureSources?: LuaSourceCorrespondence;
};

type ObjectConstant = ProgramConstant;

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

function relocateLexicalDeclaration(
	sourceIndex: number,
	sourceLocals: ReadonlyArray<Blua32LexicalDeclarationDebug>,
	remap: Int32Array,
	lexicalDeclarations: Blua32LexicalDeclarationDebug[],
	previous?: Blua32LinkBaseline,
): number {
	let index = remap[sourceIndex];
	if (index === -1) {
		index = lexicalDeclarations.length;
		const local = sourceLocals[sourceIndex];
		if (previous === undefined) {
			lexicalDeclarations.push(local);
		} else {
			let definition: SourceRange | null = null;
			if (local.definition !== null && previous.captureSources !== undefined) {
				const mapped = local.kind === LexicalDeclarationKind.Receiver
					? previous.captureSources.functionRange(local.definition)
					: previous.captureSources.declaration(local.definition);
				if (mapped !== undefined) definition = mapped;
			}
			lexicalDeclarations.push({ ...local, definition });
		}
		remap[sourceIndex] = index;
	}
	return index;
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

function resolveConstValueRelocation(
	reloc: ProgramConstValueReloc,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataAddress: number,
	dataLoadAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataAddress: number,
): NumberConstant {
	switch (reloc.kind) {
		case 'data_addr':
			return integerConstant(dataAddress + dataSymbols[reloc.symbolIndex].offset + reloc.addend);
		case 'data_lma_addr':
			return integerConstant(dataLoadAddress + dataSymbols[reloc.symbolIndex].offset + reloc.addend);
		case 'bss_addr':
			return integerConstant(bssAddress + bssSymbols[reloc.symbolIndex].offset + reloc.addend);
		case 'rodata_addr':
			return integerConstant(rodataAddress + rodataSymbols[reloc.symbolIndex].offset + reloc.addend);
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

export function rewriteResolvedABx(code: Uint8Array, wordIndex: number, op: OpCode, value: number): void {
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

function rewriteLocalClosures(code: Uint8Array, functionAddresses: ReadonlyArray<number>, symbolLoads: ReadonlySet<number>): void {
	const instructionCount = code.byteLength / INSTRUCTION_BYTES;
	for (let wordIndex = 1; wordIndex < instructionCount; wordIndex += 1) {
		const word = readInstructionWord(code, wordIndex);
		if (((word >>> 18) & 0x3f) !== OpCode.CLOSURE || symbolLoads.has(wordIndex)) {
			continue;
		}
		const wideWord = readInstructionWord(code, wordIndex - 1);
		if (((wideWord >>> 18) & 0x3f) !== OpCode.WIDE) {
			throw new Error('BLua32 closure instruction has no WIDE word.');
		}
		if ((wideWord & CLOSURE_ADDRESS_REGISTER_WIDE_C) !== 0) {
			continue;
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
	const textByteCount = text.code.byteLength + (functionLayout.hasTombstones ? RETIRED_FUNCTION_BYTES : 0);

	const heapService = input.domain === 'system' && input.metadata.preloadModules.includes(HEAP_SERVICE_MODULE_PATH);
	if (input.domain === 'system' && input.previous !== undefined
		&& ((input.previous.image.header.flags & HEAP_SERVICE_IMAGE_FLAG) !== 0) !== heapService)
		throw new Error('Changing the system heap service requires rebuilding and booting the system ROM.');
	let offset = heapService ? HEAP_SERVICE_IMAGE_HEADER_SIZE : BLUA32_IMAGE_HEADER_SIZE;
	let rodataOffset = 0;
	let dataLoadOffset = 0;
	let heapServiceOffset = 0;
	if (input.domain === 'cart') {
		rodataOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
		offset = rodataOffset + rodata.bytes.byteLength;
		dataLoadOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
		offset = dataLoadOffset + data.bytes.byteLength;
	}
	let functionTableOffset = alignBlua32ImageOffset(offset, input.loadAddress, BLUA32_FUNCTION_ALIGNMENT);
	if (input.domain === 'system') {
		const tableByteCount = functionCount * BLUA32_FUNCTION_RECORD_SIZE;
		const tableCapacity = input.previous === undefined
			? alignBlua32ImageOffset(tableByteCount, 0, SYSTEM_BLUA32_FUNCTION_TABLE_ALIGNMENT)
			: input.previous.image.header.rodataAddress - input.previous.image.header.functionTableAddress;
		if (tableByteCount > tableCapacity) {
			throw new Error(
				`Hot Resume needs ${functionCount} system function records, beyond the installed `
				+ `${tableCapacity / BLUA32_FUNCTION_RECORD_SIZE}-record table. Rebuild and boot the system ROM.`,
			);
		}
		offset = functionTableOffset + tableCapacity;
		rodataOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
		offset = rodataOffset + rodata.bytes.byteLength;
		if (heapService) {
			heapServiceOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
			offset = heapServiceOffset + HEAP_SERVICE_DESCRIPTOR_SIZE;
		}
		dataLoadOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
		offset = dataLoadOffset + data.bytes.byteLength;
	}
	const strings = new Blua32RomStringLayout(input.loadAddress + offset, input.previous?.image);
	const cartTableRelocated = input.domain === 'cart'
		&& !strings.reservePrefix(input.loadAddress + functionTableOffset + functionCount * BLUA32_FUNCTION_RECORD_SIZE);
	for (const value of rodata.constPool) {
		if (typeof value === 'string') strings.add(value);
	}
	for (const name of globalNameLayout.names) strings.add(textToByteString(name));
	for (const name of systemGlobalNameLayout.names) strings.add(textToByteString(name));
	offset = strings.endAddress - input.loadAddress;
	if (cartTableRelocated) {
		functionTableOffset = alignBlua32ImageOffset(offset, input.loadAddress, BLUA32_FUNCTION_ALIGNMENT);
		offset = functionTableOffset + functionCount * BLUA32_FUNCTION_RECORD_SIZE;
	}
	const upvalueTableOffset = alignBlua32ImageOffset(
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
	const constantTableOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
	offset = constantTableOffset + rodata.constPool.length * BLUA32_CONSTANT_RECORD_SIZE;
	const globalNameTableOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
	offset = globalNameTableOffset + globalNameLayout.names.length * BLUA32_GLOBAL_NAME_RECORD_SIZE;
	const systemGlobalNameTableOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
	offset = systemGlobalNameTableOffset + systemGlobalNameLayout.names.length * BLUA32_GLOBAL_NAME_RECORD_SIZE;

	const stringBucketOffset = alignBlua32ImageOffset(offset, input.loadAddress, 4);
	const stringBucketCount = strings.bucketCount();
	offset = stringBucketOffset + 4 * stringBucketCount;
	const textOffset = alignBlua32ImageOffset(offset, input.loadAddress, INSTRUCTION_BYTES);
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
		// A reserved MOV traps. If the exception handler skips it, jump back
		// to the trap instead of falling through into someone else's code.
		const word = text.code.byteLength / INSTRUCTION_BYTES;
		const back = (1 << BASE_BX_BITS) - 2;
		writeInstruction(code, word, OpCode.MOV, 0, 0, ValueMoveKind.FloatFromBits + 1);
		writeInstruction(code, word + 1, OpCode.JMP, 0,
			(back & MAX_LOW_BX) >>> MAX_OPERAND_BITS, back & MAX_LOW_OPERAND, back >>> MAX_BX_BITS);
	}
	const symbolLoads = new Set<number>();
	for (const reloc of object.link.constRelocs) {
		if (reloc.kind === 'export_proto' || reloc.kind === 'module_init') symbolLoads.add(reloc.wordIndex);
	}
	if (input.domain === 'cart') {
		for (const reloc of input.object.link.biosFunctionConstRelocs) symbolLoads.add(reloc.wordIndex);
	}
	rewriteLocalClosures(code, functionAddressByProtoIndex, symbolLoads);
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
	const rodataByteCount = heapService ? heapServiceOffset + HEAP_SERVICE_DESCRIPTOR_SIZE - rodataOffset : rodata.bytes.byteLength;
	const rodataBytes = rodata.bytes.slice();
	for (let index = 0; index < object.link.rodataConstRelocs.length; index += 1) {
		const reloc = object.link.rodataConstRelocs[index];
		writeLE32(rodataBytes, reloc.byteOffset, reloc.constIndex);
	}

	const bytes = new Uint8Array(imageByteCount);
	writeLE32(bytes, BLUA32_IMAGE_MAGIC_OFFSET, BLUA32_IMAGE_MAGIC);
	writeLE32(bytes, BLUA32_IMAGE_BYTE_COUNT_OFFSET, imageByteCount);
	writeLE32(bytes, BLUA32_IMAGE_FLAGS_OFFSET, heapService ? HEAP_SERVICE_IMAGE_FLAG : 0);
	if (heapService) writeLE32(bytes, HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, input.loadAddress + heapServiceOffset);
	writeLE32(bytes, BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET, functionTableAddress);
	writeLE32(bytes, BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, functionCount);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET, input.loadAddress + constantTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, constants.length);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, input.loadAddress + globalNameTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, globalNameLayout.names.length);
	writeLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, input.loadAddress + systemGlobalNameTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET, systemGlobalNameLayout.names.length);
	writeLE32(bytes, BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET, input.loadAddress + stringBucketOffset);
	writeLE32(bytes, BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET, stringBucketCount);
	writeLE32(bytes, BLUA32_IMAGE_RODATA_ADDRESS_OFFSET, rodataAddress);
	writeLE32(bytes, BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET, rodataByteCount);
	writeLE32(bytes, BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET, dataLoadAddress);
	writeLE32(bytes, BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET, data.bytes.byteLength);
	writeLE32(bytes, BLUA32_IMAGE_DATA_ADDRESS_OFFSET, input.dataAddress);
	writeLE32(bytes, BLUA32_IMAGE_BSS_ADDRESS_OFFSET, input.bssAddress);
	writeLE32(bytes, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, bss.byteCount);
	writeLE32(bytes, BLUA32_IMAGE_TEXT_ADDRESS_OFFSET, input.loadAddress + textOffset);
	writeLE32(bytes, BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET, code.byteLength);
	writeLE32(bytes, BLUA32_IMAGE_INIT_FUNCTION_ADDRESS_OFFSET,
		object.vectors.initProtoIndex === null ? 0 : functionAddressByProtoIndex[object.vectors.initProtoIndex]);

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
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, currentProto === null ? RETIRED_FUNCTION_BYTES : currentProto.codeLen);
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
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.String);
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET, strings.addressOf(value));
		} else {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, value.kind === 'integer' ? Blua32ConstantTag.Integer : Blua32ConstantTag.Float);
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET, value.word);
		}
	}

	const writeNames = (tableOffset: number, names: ReadonlyArray<string>): void => {
		for (let index = 0; index < names.length; index += 1) {
			const recordOffset = tableOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			writeLE32(bytes, recordOffset + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET, strings.addressOf(textToByteString(names[index])));
		}
	};
	writeNames(globalNameTableOffset, globalNameLayout.names);
	writeNames(systemGlobalNameTableOffset, systemGlobalNameLayout.names);
	strings.write(bytes, input.loadAddress, stringBucketOffset, stringBucketCount);
	bytes.set(rodataBytes, rodataOffset);
	bytes.set(data.bytes, dataLoadOffset);
	bytes.set(code, textOffset);

	const staticLayoutToken = buildStaticLayoutToken(
		rodataAddress,
		rodataByteCount,
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
	const outerBindingsByFunction = new Array<Blua32DebugMetadata['outerBindingsByFunction'][number]>(functionCount);
	const staticBindingsByFunction = new Array<Blua32DebugMetadata['staticScopes']['bindingsByFunction'][number]>(functionCount);
	const upvalueBindingsByFunction = new Array<Blua32DebugMetadata['upvalueBindingsByFunction'][number]>(functionCount);
	const lexicalDeclarations: Blua32LexicalDeclarationDebug[] = [];
	const declarationRemap = new Int32Array(input.metadata.lexicalDeclarations.length).fill(-1);
	const previousDeclarationRemap = functionLayout.hasTombstones
		? new Int32Array(input.previous!.symbols.metadata.lexicalDeclarations.length).fill(-1)
		: null;
	const functionDisplayNames = new Array<string>(functionCount);
	const functionDefinitions = new Array<SourceRange | null>(functionCount);
	const noDebugRecords: readonly [] = [];
	for (let slot = 0; slot < functionCount; slot += 1) {
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		if (protoIndex < 0) {
			functionDefinitions[slot] = null;
			functionDisplayNames[slot] = input.previous!.symbols.metadata.functionDisplayNames[slot];
			statementPointsByFunction[slot] = noDebugRecords;
			resumePointsByFunction[slot] = noDebugRecords;
			localSlotsByFunction[slot] = noDebugRecords;
			outerBindingsByFunction[slot] = noDebugRecords;
			staticBindingsByFunction[slot] = noDebugRecords;
			upvalueBindingsByFunction[slot] = input.previous!.symbols.metadata.upvalueBindingsByFunction[slot].map(capture =>
				relocateLexicalDeclaration(capture, input.previous!.symbols.metadata.lexicalDeclarations, previousDeclarationRemap!, lexicalDeclarations, input.previous!));
			continue;
		}
		functionDisplayNames[slot] = input.metadata.protoDisplayNames[protoIndex];
		functionDefinitions[slot] = input.metadata.functionDefinitionsByProto[protoIndex];
		statementPointsByFunction[slot] = input.metadata.statementPointsByProto[protoIndex];
		resumePointsByFunction[slot] = input.metadata.resumePointsByProto[protoIndex];
		localSlotsByFunction[slot] = input.metadata.localSlotsByProto[protoIndex];
		staticBindingsByFunction[slot] = input.metadata.staticScopes.bindingsByProto[protoIndex];
		upvalueBindingsByFunction[slot] = input.metadata.upvalueBindingsByProto[protoIndex].map(capture =>
			relocateLexicalDeclaration(capture, input.metadata.lexicalDeclarations, declarationRemap, lexicalDeclarations));
		outerBindingsByFunction[slot] = input.metadata.outerBindingsByProto[protoIndex].map(binding => ({
			...binding,
			declarationIndex: relocateLexicalDeclaration(binding.declarationIndex, input.metadata.lexicalDeclarations, declarationRemap, lexicalDeclarations),
		}));
	}
	const debugInlineCallSiteTable = buildDebugInlineCallSiteTable(
		input.metadata.debugInlineCallSites,
	);
	const metadata: Blua32DebugMetadata = {
		staticScopes: {
			globals: input.metadata.staticScopes.globals,
			bindingsByFunction: staticBindingsByFunction,
			declarations: input.metadata.staticScopes.declarations.map((declaration): Blua32StaticDeclarationDebug => {
				const { name, definition, kind } = declaration;
				switch (kind) {
					case StaticDeclarationKind.Type: return { name, definition, kind };
					case StaticDeclarationKind.Bss: return { name, definition, kind, address: input.bssAddress + bss.symbols[declaration.symbolIndex].offset };
					case StaticDeclarationKind.Data: return { name, definition, kind, address: input.dataAddress + data.symbols[declaration.symbolIndex].offset };
					case StaticDeclarationKind.Rodata: return { name, definition, kind, address: rodataAddress + rodata.symbols[declaration.symbolIndex].offset };
				}
			}),
		},
		optLevel: input.metadata.optLevel,
		traceStatements: input.metadata.traceStatements,
		preloadModules: input.metadata.preloadModules,
		compiledModulePaths: input.metadata.compiledModulePaths,
		functionIds: functionLayout.functionIds,
		functionDisplayNames,
		functionDefinitions,
		globalNames: globalNameLayout.names,
		systemGlobalNames: systemGlobalNameLayout.names,
		staticFunctionIdBySlot: input.metadata.exportProtoIdBySlot,
		debugRanges: functionLayout.hasTombstones
			? [...input.metadata.debugRanges, null, null]
			: input.metadata.debugRanges,
		debugInlineCallSiteChains: debugInlineCallSiteTable.debugInlineCallSiteChains,
		debugInlineCallSiteChainIds: functionLayout.hasTombstones
			? [...debugInlineCallSiteTable.debugInlineCallSiteChainIds, 0, 0]
			: debugInlineCallSiteTable.debugInlineCallSiteChainIds,
		statementPointsByFunction,
		resumePointsByFunction,
		localSlotsByFunction,
		outerBindingsByFunction,
		lexicalDeclarations,
		upvalueBindingsByFunction,
	};
	const symbols: Blua32SymbolsImage = {
		imageAddress: input.loadAddress,
		functionAddresses,
		moduleFunctions,
		initParticipants: object.link.symbols.initParticipants,
		staticLayoutToken,
		metadata,
	};
	const layout = decodeBlua32Image(bytes, input.loadAddress);
	if (input.domain === 'system') {
		const fixedEntries = input.biosExports.flatMap((entry, index) => entry.fixedStack ? [index] : []);
		if (heapService)
			linkBlua32HeapService(layout, heapServiceOffset, rodata.moduleExports, localFunctionAddressBySymbol, object.link.constValueRelocs, fixedEntries);
		else if (fixedEntries.length !== 0)
			throw new Error('Resident firmware entries require the fixed system stack.');
		return {
			domain: 'system',
			bytes,
			layout,
			symbols,
			functionProtoIndices: functionLayout.protoIndexBySlot,
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
		};
	}
	return {
		domain: 'cart',
		bytes,
		layout,
		symbols,
		functionProtoIndices: functionLayout.protoIndexBySlot,
		startupFunctionAddress: functionAddressByProtoIndex[object.vectors.resetProtoIndex],
		irqFunctionAddress: functionAddressByProtoIndex[object.vectors.irqProtoIndex],
		exceptionFunctionAddress: functionAddressByProtoIndex[object.vectors.exceptionProtoIndex],
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

	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		if (reloc.kind !== 'link_value' || reloc.modulePath !== modulePath) {
			continue;
		}
		const value = evaluateProgramLinkValueExpression(reloc.expression, values);
		const record = constantTableOffset + reloc.constIndex * BLUA32_CONSTANT_RECORD_SIZE;
		writeLE32(linked.bytes, record + BLUA32_CONSTANT_TAG_OFFSET, value.kind === 'integer' ? Blua32ConstantTag.Integer : Blua32ConstantTag.Float);
		writeLE32(linked.bytes, record + BLUA32_CONSTANT_PAYLOAD_OFFSET, value.word);
		linked.layout.constants[reloc.constIndex] = value;
	}
}
