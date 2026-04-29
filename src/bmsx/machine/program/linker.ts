// start repeated-sequence-acceptable -- Program linker rewrites packed instruction fields directly to preserve bit-level clarity.
import { OpCode, type ProgramMetadata, type Proto, type SourceRange } from '../cpu/cpu';
import {
	BASE_BX_BITS,
	EXT_B_BITS,
	EXT_C_BITS,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	MAX_EXT_BX,
	MAX_LOW_BX,
	MAX_OPERAND_BITS,
	readInstructionWord,
	writeInstruction,
} from '../cpu/instruction_format';
import { resolveProgramLayout, type ProgramLayout } from './layout';
import type {
	EncodedProgram,
	EncodedValue,
	ProgramImage,
	ProgramConstReloc,
	ProgramSymbolsImage,
} from './loader';

type LinkedProgramImage = {
	programImage: ProgramImage;
	metadata: ProgramMetadata | null;
	systemEntryProtoIndex: number;
	cartEntryProtoIndex: number;
	systemStaticModulePaths: ReadonlyArray<string>;
	cartStaticModulePaths: ReadonlyArray<string>;
};

const NUMBER_KEY_BUFFER = new ArrayBuffer(8);
const NUMBER_KEY_VIEW = new DataView(NUMBER_KEY_BUFFER);
const NAN_KEY = 'n:0x7ff8000000000000';
const EMPTY_SLOT_NAMES: ReadonlyArray<string> = [];

const makeNumberKey = (value: number): string => {
	if (Number.isNaN(value)) {
		return NAN_KEY;
	}
	NUMBER_KEY_VIEW.setFloat64(0, value, false);
	const hi = NUMBER_KEY_VIEW.getUint32(0, false).toString(16).padStart(8, '0');
	const lo = NUMBER_KEY_VIEW.getUint32(4, false).toString(16).padStart(8, '0');
	return `n:0x${hi}${lo}`;
};

const makeConstKey = (value: EncodedValue): string => {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'b:1' : 'b:0';
	}
	if (typeof value === 'number') {
		return makeNumberKey(value);
	}
	return `s:${value}`;
};

const mergeConstPools = (
	systemConstPool: ReadonlyArray<EncodedValue>,
	cartConstPool: ReadonlyArray<EncodedValue>,
): { constPool: EncodedValue[]; cartConstRemap: number[] } => {
	const constPool: EncodedValue[] = systemConstPool.slice();
	const keyToIndex = new Map<string, number>();
	for (let index = 0; index < systemConstPool.length; index += 1) {
		const key = makeConstKey(systemConstPool[index]);
		if (!keyToIndex.has(key)) {
			keyToIndex.set(key, index);
		}
	}
	const cartConstRemap: number[] = new Array(cartConstPool.length);
	for (let index = 0; index < cartConstPool.length; index += 1) {
		const value = cartConstPool[index];
		const key = makeConstKey(value);
		const existing = keyToIndex.get(key);
		if (existing !== undefined) {
			cartConstRemap[index] = existing;
			continue;
		}
		const nextIndex = constPool.length;
		constPool.push(value);
		keyToIndex.set(key, nextIndex);
		cartConstRemap[index] = nextIndex;
	}
	return { constPool, cartConstRemap };
};

const mergeNamedSlots = (
	systemNames: ReadonlyArray<string>,
	cartNames: ReadonlyArray<string>,
): { names: string[]; cartRemap: number[] } => {
	const names: string[] = systemNames.slice();
	const nameToIndex = new Map<string, number>();
	for (let index = 0; index < systemNames.length; index += 1) {
		const name = systemNames[index];
		if (!nameToIndex.has(name)) {
			nameToIndex.set(name, index);
		}
	}
	const cartRemap: number[] = new Array(cartNames.length);
	for (let index = 0; index < cartNames.length; index += 1) {
		const name = cartNames[index];
		const existing = nameToIndex.get(name);
		if (existing !== undefined) {
			cartRemap[index] = existing;
			continue;
		}
		const mergedIndex = names.length;
		names.push(name);
		nameToIndex.set(name, mergedIndex);
		cartRemap[index] = mergedIndex;
	}
	return { names, cartRemap };
};

const encodeSignedRaw = (value: number, bits: number): number => {
	const mask = (1 << bits) - 1;
	return value & mask;
};

const fitsSignedRaw = (value: number, bits: number): boolean => {
	const min = -(1 << (bits - 1));
	const max = (1 << (bits - 1)) - 1;
	return value >= min && value <= max;
};

const rewriteConstRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	cartConstRemap: ReadonlyArray<number>,
	cartGlobalRemap: ReadonlyArray<number>,
	cartSystemGlobalRemap: ReadonlyArray<number>,
	mergedConstPool: ReadonlyArray<EncodedValue>,
	mergedGlobalNames: ReadonlyArray<string>,
	mergedSystemGlobalNames: ReadonlyArray<string>,
): void => {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		const wordIndex = reloc.wordIndex;
		const word = readInstructionWord(code, wordIndex);
		const op = (word >>> 18) & 0x3f;
		const hasWide = wordIndex > 0 && ((readInstructionWord(code, wordIndex - 1) >>> 18) & 0x3f) === OpCode.WIDE;
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		if (hasWide) {
			const wideWord = readInstructionWord(code, wordIndex - 1);
			wideA = (wideWord >>> 12) & 0x3f;
			wideB = (wideWord >>> 6) & 0x3f;
			wideC = wideWord & 0x3f;
		}
		const aLow = (word >>> 12) & 0x3f;
		let bLow = (word >>> 6) & 0x3f;
		let cLow = word & 0x3f;
		let ext = word >>> 24;

		const mappedIndex = reloc.kind === 'gl'
			? cartGlobalRemap[reloc.constIndex]
			: reloc.kind === 'sys'
				? cartSystemGlobalRemap[reloc.constIndex]
				: cartConstRemap[reloc.constIndex];
		switch (reloc.kind) {
			case 'module': {
				const mappedConstIndex = cartConstRemap[reloc.constIndex];
				const constVal = mappedConstIndex >= 0 ? mergedConstPool[mappedConstIndex] : undefined;
				if (typeof constVal !== 'string') {
					throw new Error(`[ProgramLinker] Module reloc at word ${wordIndex} references a non-string const.`);
				}
				let slotName = constVal;
				if (slotName.startsWith('modslot:')) {
					slotName = slotName.slice('modslot:'.length);
				}
				let slotIndex = mergedSystemGlobalNames.indexOf(slotName);
				let useSystem = true;
				if (slotIndex < 0) {
					slotIndex = mergedGlobalNames.indexOf(slotName);
					useSystem = false;
				}
				if (slotIndex < 0) {
					throw new Error(`[ProgramLinker] Unable to resolve module export slot '${slotName}' during linking.`);
				}
				const mappedIndex2 = slotIndex;
				const nextWide2 = mappedIndex2 >> BASE_BX_BITS;
				if (!hasWide && nextWide2 !== 0) {
					throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
				}
				const nextExt2 = (mappedIndex2 >> MAX_BX_BITS) & 0xff;
				const nextLow2 = mappedIndex2 & MAX_LOW_BX;
				bLow = (nextLow2 >>> 6) & 0x3f;
				cLow = nextLow2 & 0x3f;
				ext = nextExt2;
				if (hasWide) {
					wideB = nextWide2 & 0x3f;
					writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
				}
				writeInstruction(code, wordIndex, useSystem ? OpCode.GETSYS : OpCode.GETGL, aLow, bLow, cLow, ext);
				continue;
			}
			case 'bx':
			case 'gl':
			case 'sys': {
			const nextWide = mappedIndex >> BASE_BX_BITS;
			if (!hasWide && nextWide !== 0) {
				throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
			}
			const nextExt = (mappedIndex >> MAX_BX_BITS) & 0xff;
			const nextLow = mappedIndex & MAX_LOW_BX;
			bLow = (nextLow >>> 6) & 0x3f;
			cLow = nextLow & 0x3f;
			ext = nextExt;
			if (hasWide) {
				wideB = nextWide & 0x3f;
				writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
			}
			writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
			continue;
			}
			case 'const_b':
			case 'const_c': {
			const relocOnB = reloc.kind === 'const_b';
			const extBits = relocOnB ? EXT_B_BITS : EXT_C_BITS;
			const baseBits = MAX_OPERAND_BITS + extBits;
			const maxBase = (1 << baseBits) - 1;
			if (!hasWide && mappedIndex > maxBase) {
				throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
			}
			const totalBits = baseBits + (hasWide ? MAX_OPERAND_BITS : 0);
			const maxValue = (1 << totalBits) - 1;
			if (mappedIndex > maxValue) {
				throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} exceeds operand range.`);
			}
			const low = mappedIndex & 0x3f;
			const extPartMask = (1 << extBits) - 1;
			const extPart = (mappedIndex >> MAX_OPERAND_BITS) & extPartMask;
			const widePart = mappedIndex >> baseBits;

			const extA = (ext >>> 6) & 0x3;
			let extB = (ext >>> 3) & 0x7;
			let extC = ext & 0x7;
			if (relocOnB) {
				bLow = low;
				extB = extPart;
				if (hasWide) {
					wideB = widePart & 0x3f;
				}
			} else {
				cLow = low;
				extC = extPart;
				if (hasWide) {
					wideC = widePart & 0x3f;
				}
			}
			ext = (extA << 6) | (extB << 3) | extC;
			if (hasWide) {
				writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
			}
			writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
			continue;
			}
		}

		const relocOnB = reloc.kind === 'rk_b';
		const rkValue = -mappedIndex - 1;
		const extBits = relocOnB ? EXT_B_BITS : EXT_C_BITS;
		const baseBits = MAX_OPERAND_BITS + extBits;
		if (!hasWide && !fitsSignedRaw(rkValue, baseBits)) {
			throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
		}
		const totalBits = baseBits + (hasWide ? MAX_OPERAND_BITS : 0);
		const raw = encodeSignedRaw(rkValue, totalBits);
		const low = raw & 0x3f;
		const extPartMask = (1 << extBits) - 1;
		const extPart = (raw >> MAX_OPERAND_BITS) & extPartMask;
		const widePart = raw >> baseBits;

		const extA = (ext >>> 6) & 0x3;
		let extB = (ext >>> 3) & 0x7;
		let extC = ext & 0x7;
		if (relocOnB) {
			bLow = low;
			extB = extPart;
			if (hasWide) {
				wideB = widePart & 0x3f;
			}
		} else {
			cLow = low;
			extC = extPart;
			if (hasWide) {
				wideC = widePart & 0x3f;
			}
		}
		ext = (extA << 6) | (extB << 3) | extC;
		if (hasWide) {
			writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
		}
		writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
	}
};

const rewriteClosureIndices = (code: Uint8Array, protoOffset: number): void => {
	if (protoOffset === 0) {
		return;
	}
	const instructionCount = code.length / INSTRUCTION_BYTES;
	let wideIndex = -1;
	let wideA = 0;
	let wideB = 0;
	let wideC = 0;
	for (let index = 0; index < instructionCount; index += 1) {
		const word = readInstructionWord(code, index);
		const ext = word >>> 24;
		const op = (word >>> 18) & 0x3f;
		if (op === OpCode.WIDE) {
			wideIndex = index;
			wideA = (word >>> 12) & 0x3f;
			wideB = (word >>> 6) & 0x3f;
			wideC = word & 0x3f;
			continue;
		}
		if (op !== OpCode.CLOSURE) {
			wideIndex = -1;
			wideA = 0;
			wideB = 0;
			wideC = 0;
			continue;
		}
		const aLow = (word >>> 12) & 0x3f;
		const bLow = (word >>> 6) & 0x3f;
		const cLow = word & 0x3f;
		const bxLow = (bLow << 6) | cLow;
		const bx = (wideB << BASE_BX_BITS) | (ext << MAX_BX_BITS) | bxLow;
		const nextBx = bx + protoOffset;
		if (nextBx > MAX_EXT_BX) {
			throw new Error(`[ProgramLinker] Proto index exceeds range: ${nextBx}.`);
		}
		const nextWide = nextBx >> BASE_BX_BITS;
		if (nextWide !== 0 && wideIndex < 0) {
			throw new Error(`[ProgramLinker] Proto index ${nextBx} requires WIDE prefix.`);
		}
		const nextExt = (nextBx >> MAX_BX_BITS) & 0xff;
		const nextLow = nextBx & MAX_LOW_BX;
		writeInstruction(code, index, op, aLow, (nextLow >>> 6) & 0x3f, nextLow & 0x3f, nextExt);
		if (wideIndex >= 0) {
			writeInstruction(code, wideIndex, OpCode.WIDE, wideA, nextWide & 0x3f, wideC);
		}
		wideIndex = -1;
		wideA = 0;
		wideB = 0;
		wideC = 0;
	}
};


const mergeMetadata = (
	system: ProgramMetadata | undefined,
	cart: ProgramMetadata | undefined,
	layout: ProgramLayout,
	systemInstructionCount: number,
	cartInstructionCount: number,
): ProgramMetadata | null => {
	if (!system && !cart) {
		return null;
	}
	if (!system || !cart) {
		throw new Error('[ProgramLinker] Linking requires both system and cart symbols when symbols are provided.');
	}
	if (system.debugRanges.length !== systemInstructionCount) {
		throw new Error('[ProgramLinker] System debug range length mismatch.');
	}
	if (cart.debugRanges.length !== cartInstructionCount) {
		throw new Error('[ProgramLinker] Cart debug range length mismatch.');
	}
	const mergedSystemGlobals = mergeNamedSlots(system.systemGlobalNames, cart.systemGlobalNames);
	const mergedGlobals = mergeNamedSlots(system.globalNames, cart.globalNames);
	const systemBaseWord = layout.systemBasePc / INSTRUCTION_BYTES;
	const cartBaseWord = layout.cartBasePc / INSTRUCTION_BYTES;
	const totalInstructionCount = Math.max(
		systemBaseWord + systemInstructionCount,
		cartBaseWord + cartInstructionCount,
	);
	const debugRanges: Array<SourceRange | null> = new Array(totalInstructionCount);
	debugRanges.fill(null);
	for (let index = 0; index < systemInstructionCount; index += 1) {
		debugRanges[systemBaseWord + index] = system.debugRanges[index];
	}
	for (let index = 0; index < cartInstructionCount; index += 1) {
		debugRanges[cartBaseWord + index] = cart.debugRanges[index];
	}
	const localSlotsByProto = system.localSlotsByProto
		? system.localSlotsByProto.concat(cart.localSlotsByProto ?? [])
		: cart.localSlotsByProto ?? [];
	return {
		debugRanges,
		protoIds: system.protoIds.concat(cart.protoIds),
		localSlotsByProto,
		upvalueNamesByProto: system.upvalueNamesByProto
			? system.upvalueNamesByProto.concat(cart.upvalueNamesByProto ?? [])
			: cart.upvalueNamesByProto ?? [],
		systemGlobalNames: mergedSystemGlobals.names,
		globalNames: mergedGlobals.names,
	};
};



/*
	Fantasy-console linking note

	- This codebase targets a fantasy-console ABI where certain system ROM modules are compile-time
	  descriptors (recorded in metadata like `staticModulePaths` / `staticExternalModulePaths`) rather
	  than runtime Lua tables.
	- The compiler enforces that these compile-time modules are not treated as runtime values and
	  lowers/validates uses (for example rejecting `local m = require('bios')`). When the compiler
	  cannot resolve an export it emits an explicit link-time placeholder into the instruction stream
	  (the current emitter uses a nil-load sentinel). The linker MUST detect and resolve these
	  placeholders into the final relocated operand or concrete machine-level access; they are not
	  intended to be left as runtime `nil` values.
	- The linker's responsibility is to combine system and cart images and remap proto/const/global
	  indices to the final layout while preserving metadata. Functions such as `rewriteClosureIndices`
	  and `rewriteConstRelocations` update indices/operands and must preserve encoding semantics when
	  rewriting the linked buffer.

*/

export const linkProgramImages = (
	systemImage: ProgramImage,
	systemSymbols: ProgramSymbolsImage | null,
	cartImage: ProgramImage,
	cartSymbols: ProgramSymbolsImage | null,
	layout?: Partial<ProgramLayout>,
): LinkedProgramImage => {
	const baseProtoCount = systemImage.program.protos.length;
	const systemCodeBytes = systemImage.program.code.length;
	const cartCodeBytes = cartImage.program.code.length;
	const systemInstructionCount = systemCodeBytes / INSTRUCTION_BYTES;
	const cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	const resolvedLayout = resolveProgramLayout(systemCodeBytes, layout);
	const totalBytes = Math.max(
		resolvedLayout.systemBasePc + systemCodeBytes,
		resolvedLayout.cartBasePc + cartCodeBytes,
	);
	const code = new Uint8Array(totalBytes);
	code.set(systemImage.program.code, resolvedLayout.systemBasePc);
	code.set(cartImage.program.code, resolvedLayout.cartBasePc);
	const cartCode = code.subarray(resolvedLayout.cartBasePc, resolvedLayout.cartBasePc + cartCodeBytes);
	rewriteClosureIndices(cartCode, baseProtoCount);
	const mergedConsts = mergeConstPools(systemImage.program.constPool, cartImage.program.constPool);
	const systemMetadata = systemSymbols?.metadata;
	const cartMetadata = cartSymbols?.metadata;

	// If the cart contains any 'module' const-relocs we must have full symbol metadata
	// available from both system and cart so module export slot names (in global/system
	// name tables) can be resolved. Do not silently default to empty lists in that case;
	// surface a clear diagnostic so the caller can fix the pipeline (compiler/rompacker)
	// instead of letting the linker fabricate names.
	const hasModuleRelocs = cartImage.link.constRelocs.some(r => r.kind === 'module');
	if (hasModuleRelocs) {
		if (!systemMetadata || !cartMetadata) {
			throw new Error('[ProgramLinker] Missing program symbols metadata required to resolve module relocations. Provide both systemSymbols and cartSymbols with metadata when linking a cart that contains module placeholders.');
		}
		if (!Array.isArray(systemMetadata.systemGlobalNames) || !Array.isArray(cartMetadata.systemGlobalNames) || !Array.isArray(systemMetadata.globalNames) || !Array.isArray(cartMetadata.globalNames)) {
			throw new Error('[ProgramLinker] Incomplete program symbols metadata: expected globalNames and systemGlobalNames arrays in both system and cart symbols.');
		}
	}

	const mergedSystemGlobals = hasModuleRelocs
		? mergeNamedSlots(systemMetadata!.systemGlobalNames, cartMetadata!.systemGlobalNames)
		: mergeNamedSlots(systemMetadata?.systemGlobalNames ?? EMPTY_SLOT_NAMES, cartMetadata?.systemGlobalNames ?? EMPTY_SLOT_NAMES);
	const mergedGlobals = hasModuleRelocs
		? mergeNamedSlots(systemMetadata!.globalNames, cartMetadata!.globalNames)
		: mergeNamedSlots(systemMetadata?.globalNames ?? EMPTY_SLOT_NAMES, cartMetadata?.globalNames ?? EMPTY_SLOT_NAMES);
	rewriteConstRelocations(
		cartCode,
		cartImage.link.constRelocs,
		mergedConsts.cartConstRemap,
		mergedGlobals.cartRemap,
		mergedSystemGlobals.cartRemap,
		mergedConsts.constPool,
		mergedGlobals.names,
		mergedSystemGlobals.names,
	);

	const systemProtos = systemImage.program.protos;
	const cartProtos = cartImage.program.protos;
	const protos: Proto[] = new Array(systemProtos.length + cartProtos.length);
	let protoIndex = 0;
	for (let index = 0; index < systemProtos.length; index += 1) {
		const proto = systemProtos[index];
		protos[protoIndex] = {
			entryPC: proto.entryPC + resolvedLayout.systemBasePc,
			codeLen: proto.codeLen,
			numParams: proto.numParams,
			isVararg: proto.isVararg,
			maxStack: proto.maxStack,
			upvalueDescs: proto.upvalueDescs,
		};
		protoIndex += 1;
	}
	for (let index = 0; index < cartProtos.length; index += 1) {
		const proto = cartProtos[index];
		protos[protoIndex] = {
			entryPC: proto.entryPC + resolvedLayout.cartBasePc,
			codeLen: proto.codeLen,
			numParams: proto.numParams,
			isVararg: proto.isVararg,
			maxStack: proto.maxStack,
			upvalueDescs: proto.upvalueDescs,
		};
		protoIndex += 1;
	}

	const program: EncodedProgram = {
		code,
		constPool: mergedConsts.constPool,
		protos,
	};

	const moduleProtos: Array<{ path: string; protoIndex: number }> = [];
	for (const entry of cartImage.moduleProtos ?? []) {
		moduleProtos.push({ path: entry.path, protoIndex: entry.protoIndex + baseProtoCount });
	}
	for (const entry of systemImage.moduleProtos ?? []) {
		moduleProtos.push({ path: entry.path, protoIndex: entry.protoIndex });
	}
	const systemStaticModulePaths = systemImage.staticModulePaths ?? [];
	const cartStaticModulePaths = cartImage.staticModulePaths ?? [];
	const staticModulePaths = systemStaticModulePaths.concat(cartStaticModulePaths);
	const systemEntryProtoIndex = systemImage.entryProtoIndex;
	const cartEntryProtoIndex = cartImage.entryProtoIndex + baseProtoCount;
	const metadata = mergeMetadata(
		systemMetadata,
		cartMetadata,
		resolvedLayout,
		systemInstructionCount,
		cartInstructionCount,
	);

	return {
		programImage: {
			entryProtoIndex: cartEntryProtoIndex,
			program,
			moduleProtos,
			staticModulePaths,
			link: { constRelocs: [] },
		},
		metadata,
		systemEntryProtoIndex,
		cartEntryProtoIndex,
		systemStaticModulePaths,
		cartStaticModulePaths,
	};
};
// end repeated-sequence-acceptable
