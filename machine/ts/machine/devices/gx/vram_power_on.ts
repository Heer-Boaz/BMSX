import { fmix32, scramble32, signed8FromHash, xorshift32 } from '../../common/hash';
import { GX_GPU_VRAM_BYTE_COUNT } from './gpu_command_buffer';

const GX_GPU_VRAM_POWER_ON_BLOCK_BYTES = 32;
const GX_GPU_VRAM_POWER_ON_BLOCK_WORDS = GX_GPU_VRAM_POWER_ON_BLOCK_BYTES >>> 2;
// Fixed seeds make the hardware power-on state reproducible across mirrored runtimes and test runs.
const GX_GPU_VRAM_POWER_ON_BIAS_SEED = 0x14040c15;
const GX_GPU_VRAM_POWER_ON_BOOT_SEED = 0x20000000;
// One MiB activates the 64 KiB macro octave: 15 * 127 maximum bias at 12%, 28%, and 48%.
const GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_0 = 228;
const GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_1 = 533;
const GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_2 = 914;

export function initializeGxGpuVramPowerOn(vramBytes: Uint8Array): void {
	let pageHash = 0;
	let rowHash = 0;
	let macroHash = 0;
	let preferredWord = 0;
	const blockCount = GX_GPU_VRAM_BYTE_COUNT >>> 5;
	for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
		if ((blockIndex & 0x7ff) === 0) {
			const macroIndex = blockIndex >>> 11;
			macroHash = fmix32((GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ Math.imul(macroIndex, 0x165667b1) ^ 0xd3a2646c) >>> 0);
			preferredWord = scramble32(macroHash);
		}
		if ((blockIndex & 0x7f) === 0) {
			const pageIndex = blockIndex >>> 7;
			pageHash = fmix32((GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ Math.imul(pageIndex, 0xc2b2ae35) ^ 0xa5a5a5a5) >>> 0);
		}
		if ((blockIndex & 0x07) === 0) {
			const rowIndex = blockIndex >>> 3;
			rowHash = fmix32((GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ Math.imul(rowIndex, 0x85ebca6b) ^ 0x1b873593) >>> 0);
		}
		const blockHash = fmix32((GX_GPU_VRAM_POWER_ON_BIAS_SEED ^ Math.imul(blockIndex, 0x9e3779b9) ^ 0x85ebca77) >>> 0);

		const bias = signed8FromHash(pageHash) * 4
			+ signed8FromHash(rowHash) * 2
			+ signed8FromHash(blockHash)
			+ signed8FromHash(macroHash) * 8;
		const absoluteBias = bias < 0 ? -bias : bias;
		const forceLevel = absoluteBias < GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_0 ? 0
			: absoluteBias < GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_1 ? 1
				: absoluteBias < GX_GPU_VRAM_POWER_ON_FORCE_THRESHOLD_2 ? 2 : 3;
		const jitterLevel = 3 - forceLevel;

		let patternState = (blockHash ^ rowHash ^ 0xdeadbeef) >>> 0;
		patternState |= 1;
		patternState = xorshift32(patternState);
		const forcePattern1 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const forcePattern2 = scramble32(patternState);
		patternState = xorshift32(xorshift32(patternState));
		const weakPattern1 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const weakPattern2 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const weakPattern3 = scramble32(patternState);
		patternState = xorshift32(patternState);
		const weakPattern4 = scramble32(patternState);

		let forceMask = 0;
		switch (forceLevel) {
			case 1: forceMask = (forcePattern1 & forcePattern2) >>> 0; break;
			case 2: forceMask = forcePattern1; break;
			case 3: forceMask = (forcePattern1 | forcePattern2) >>> 0; break;
		}

		let weakMask = (weakPattern1 & weakPattern2 & weakPattern3) >>> 0;
		if (jitterLevel <= 2) weakMask &= weakPattern4;
		if (jitterLevel <= 1) weakMask &= weakMask >>> 1;
		if (jitterLevel === 0) weakMask = 0;
		weakMask &= ~forceMask;

		let baseState = ((blockHash ^ 0xa1b2c3d4) >>> 0) | 1;
		let bootState = fmix32((GX_GPU_VRAM_POWER_ON_BOOT_SEED ^ Math.imul(blockIndex, 0x7f4a7c15) ^ 0x31415926) >>> 0) | 1;
		const blockByteOffset = blockIndex << 5;
		for (let wordIndex = 0; wordIndex < GX_GPU_VRAM_POWER_ON_BLOCK_WORDS; wordIndex += 1) {
			baseState = xorshift32(baseState);
			bootState = xorshift32(bootState);
			const baseWord = scramble32(baseState);
			const bootWord = scramble32(bootState);
			const word = (((baseWord & ~forceMask) | (preferredWord & forceMask)) ^ (bootWord & weakMask)) >>> 0;
			const byteOffset = blockByteOffset + (wordIndex << 2);
			vramBytes[byteOffset] = word & 0xff;
			vramBytes[byteOffset + 1] = (word >>> 8) & 0xff;
			vramBytes[byteOffset + 2] = (word >>> 16) & 0xff;
			vramBytes[byteOffset + 3] = word >>> 24;
		}
	}
}
