import { fmix32, scramble32, signed8FromHash, xorshift32 } from '../../common/hash';
import {
	VRAM_SECONDARY_SLOT_BASE,
	VRAM_SECONDARY_SLOT_SIZE,
	VRAM_STAGING_BASE,
} from '../../memory/map';

export const VRAM_GARBAGE_CHUNK_BYTES = 64 * 1024;
export const VRAM_GARBAGE_SPACE_SALT = 0x5652414d;

const VRAM_GARBAGE_WEIGHT_BLOCK = 1;
const VRAM_GARBAGE_WEIGHT_ROW = 2;
const VRAM_GARBAGE_WEIGHT_PAGE = 4;
const VRAM_GARBAGE_OCTAVES = [
	{ shift: 11, weight: 8, mul: 0x165667b1, mix: 0xd3a2646c },
	{ shift: 15, weight: 12, mul: 0x27d4eb2f, mix: 0x6c8e9cf5 },
	{ shift: 17, weight: 16, mul: 0x7f4a7c15, mix: 0x31415926 },
	{ shift: 19, weight: 20, mul: 0xa24baed5, mix: 0x9e3779b9 },
	{ shift: 21, weight: 24, mul: 0x6a09e667, mix: 0xbb67ae85 },
] as const;
const VRAM_GARBAGE_FORCE_T0 = 120;
const VRAM_GARBAGE_FORCE_T1 = 280;
const VRAM_GARBAGE_FORCE_T2 = 480;
const VRAM_GARBAGE_FORCE_T_DEN = 1000;

export type VramGarbageStream = {
	machineSeed: number;
	bootSeed: number;
	slotSalt: number;
	addr: number;
};

type BlockGen = {
	forceMask: number;
	prefWord: number;
	weakMask: number;
	baseState: number;
	bootState: number;
	genWordPos: number;
};

type BiasConfig = {
	activeOctaves: number;
	threshold0: number;
	threshold1: number;
	threshold2: number;
};

function garbageForceThreshold(maxBias: number, threshold: number): number {
	const scaled = maxBias * threshold;
	return (scaled - (scaled % VRAM_GARBAGE_FORCE_T_DEN)) / VRAM_GARBAGE_FORCE_T_DEN;
}

function makeBiasConfig(vramBytes: number): BiasConfig {
	const maxOctaveBytes = vramBytes >>> 1;
	let weightSum = VRAM_GARBAGE_WEIGHT_BLOCK + VRAM_GARBAGE_WEIGHT_ROW + VRAM_GARBAGE_WEIGHT_PAGE;
	let activeOctaves = 0;
	for (let i = 0; i < VRAM_GARBAGE_OCTAVES.length; i += 1) {
		const octave = VRAM_GARBAGE_OCTAVES[i];
		const octaveBytes = (1 << (octave.shift + 5)) >>> 0;
		if (octaveBytes > maxOctaveBytes) {
			break;
		}
		weightSum += octave.weight;
		activeOctaves = i + 1;
	}
	const maxBias = weightSum * 127;
	return {
		activeOctaves,
		threshold0: garbageForceThreshold(maxBias, VRAM_GARBAGE_FORCE_T0),
		threshold1: garbageForceThreshold(maxBias, VRAM_GARBAGE_FORCE_T1),
		threshold2: garbageForceThreshold(maxBias, VRAM_GARBAGE_FORCE_T2),
	};
}

function initBlockGen(biasSeed: number, bootSeedMix: number, blockIndex: number, biasConfig: BiasConfig): BlockGen {
	const pageIndex = blockIndex >>> 7;
	const rowIndex = blockIndex >>> 3;

	const pageH = fmix32((biasSeed ^ Math.imul(pageIndex, 0xc2b2ae35) ^ 0xa5a5a5a5) >>> 0);
	const rowH = fmix32((biasSeed ^ Math.imul(rowIndex, 0x85ebca6b) ^ 0x1b873593) >>> 0);
	const blkH = fmix32((biasSeed ^ Math.imul(blockIndex, 0x9e3779b9) ^ 0x85ebca77) >>> 0);

	let bias =
		signed8FromHash(pageH) * VRAM_GARBAGE_WEIGHT_PAGE +
		signed8FromHash(rowH) * VRAM_GARBAGE_WEIGHT_ROW +
		signed8FromHash(blkH) * VRAM_GARBAGE_WEIGHT_BLOCK;

	let macroH = pageH;
	for (let i = 0; i < biasConfig.activeOctaves; i += 1) {
		const octave = VRAM_GARBAGE_OCTAVES[i];
		const octaveIndex = blockIndex >>> octave.shift;
		const octaveH = fmix32((biasSeed ^ Math.imul(octaveIndex, octave.mul) ^ octave.mix) >>> 0);
		bias += signed8FromHash(octaveH) * octave.weight;
		macroH = octaveH;
	}

	const absBias = bias < 0 ? -bias : bias;

	const forceLevel =
		absBias < biasConfig.threshold0 ? 0 :
			absBias < biasConfig.threshold1 ? 1 :
				absBias < biasConfig.threshold2 ? 2 : 3;

	const jitterLevel = 3 - forceLevel;

	let ps = (blkH ^ rowH ^ 0xdeadbeef) >>> 0;
	ps |= 1;

	ps = xorshift32(ps); const m1 = scramble32(ps);
	ps = xorshift32(ps); const m2 = scramble32(ps);
	ps = xorshift32(ps);
	const prefWord = scramble32(macroH);
	ps = xorshift32(ps); const w1 = scramble32(ps);
	ps = xorshift32(ps); const w2 = scramble32(ps);
	ps = xorshift32(ps); const w3 = scramble32(ps);
	ps = xorshift32(ps); const w4 = scramble32(ps);

	let forceMask = 0;
	switch (forceLevel) {
		case 0: forceMask = 0; break;
		case 1: forceMask = (m1 & m2) >>> 0; break;
		case 2: forceMask = m1 >>> 0; break;
		default: forceMask = (m1 | m2) >>> 0; break;
	}

	let weak = (w1 & w2 & w3) >>> 0;
	if (jitterLevel <= 2) weak &= w4;
	if (jitterLevel <= 1) weak &= (weak >>> 1);
	if (jitterLevel <= 0) weak = 0;
	weak &= (~forceMask) >>> 0;

	const baseState = ((blkH ^ 0xa1b2c3d4) >>> 0) | 1;
	const bootState = (fmix32((bootSeedMix ^ Math.imul(blockIndex, 0x7f4a7c15) ^ 0x31415926) >>> 0) | 1) >>> 0;

	return {
		forceMask,
		prefWord,
		weakMask: weak >>> 0,
		baseState,
		bootState,
		genWordPos: 0,
	};
}

function nextWord(gen: BlockGen): number {
	gen.baseState = xorshift32(gen.baseState);
	gen.bootState = xorshift32(gen.bootState);
	gen.genWordPos += 1;

	const baseWord = scramble32(gen.baseState);
	const bootWord = scramble32(gen.bootState);

	let word = (baseWord & ~gen.forceMask) | (gen.prefWord & gen.forceMask);
	word ^= (bootWord & gen.weakMask);
	return word >>> 0;
}

export function fillVramGarbageScratch(buffer: Uint8Array, s: VramGarbageStream): void {
	const total = buffer.byteLength;
	const startAddr = s.addr >>> 0;

	const biasSeed = (s.machineSeed ^ s.slotSalt) >>> 0;
	const bootSeedMix = (s.bootSeed ^ s.slotSalt) >>> 0;
	const vramBytes = (VRAM_SECONDARY_SLOT_BASE + VRAM_SECONDARY_SLOT_SIZE - VRAM_STAGING_BASE) >>> 0;
	const biasConfig = makeBiasConfig(vramBytes);

	const BLOCK_BYTES = 32;
	const BLOCK_SHIFT = 5;

	let out = 0;
	const aligned4 = (((startAddr | total) & 3) === 0);

	while (out < total) {
		const addr = (startAddr + out) >>> 0;
		const blockIndex = addr >>> BLOCK_SHIFT;
		const blockBase = (blockIndex << BLOCK_SHIFT) >>> 0;

		const startOff = (addr - blockBase) >>> 0;
		const blockRemaining = BLOCK_BYTES - startOff;
		const writeRemaining = total - out;
		const maxBytesThisBlock = blockRemaining < writeRemaining ? blockRemaining : writeRemaining;

		const gen = initBlockGen(biasSeed, bootSeedMix, blockIndex, biasConfig);

		if (aligned4 && startOff === 0 && maxBytesThisBlock === BLOCK_BYTES) {
			for (let w = 0; w < 8; w += 1) {
				const word = nextWord(gen);
				const p = out + (w << 2);
				buffer[p] = word & 0xff;
				buffer[p + 1] = (word >>> 8) & 0xff;
				buffer[p + 2] = (word >>> 16) & 0xff;
				buffer[p + 3] = (word >>> 24) & 0xff;
			}
		} else {
			const rangeStart = startOff;
			const rangeEnd = startOff + maxBytesThisBlock;

			for (let w = 0; w < 8; w += 1) {
				const word = nextWord(gen);
				const wordByteStart = w << 2;
				const wordByteEnd = wordByteStart + 4;
				const a0 = wordByteStart > rangeStart ? wordByteStart : rangeStart;
				const a1 = wordByteEnd < rangeEnd ? wordByteEnd : rangeEnd;
				if (a0 >= a1) {
					continue;
				}
				let tmp = word >>> ((a0 - wordByteStart) << 3);
				for (let k = a0; k < a1; k += 1) {
					buffer[out + (k - rangeStart)] = tmp & 0xff;
					tmp >>>= 8;
				}
			}
		}

		out += maxBytesThisBlock;
	}

	s.addr = (startAddr + total) >>> 0;
}
