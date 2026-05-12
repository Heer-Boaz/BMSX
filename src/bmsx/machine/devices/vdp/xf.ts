import { encodeSignedQ16_16 } from './fixed_point';

export type VdpXfState = {
	matrixWords: number[];
	viewMatrixIndex: number;
	projectionMatrixIndex: number;
};

export const VDP_XF_PACKET_KIND = 0x13000000;
export const VDP_XF_MATRIX_WORDS = 16;
export const VDP_XF_MATRIX_COUNT = 8;
export const VDP_XF_MATRIX_REGISTER_WORDS = VDP_XF_MATRIX_WORDS * VDP_XF_MATRIX_COUNT;
export const VDP_XF_VIEW_MATRIX_INDEX_REGISTER = VDP_XF_MATRIX_REGISTER_WORDS;
export const VDP_XF_PROJECTION_MATRIX_INDEX_REGISTER = VDP_XF_VIEW_MATRIX_INDEX_REGISTER + 1;
export const VDP_XF_REGISTER_WORDS = VDP_XF_PROJECTION_MATRIX_INDEX_REGISTER + 1;
export const VDP_XF_VIEW_MATRIX_RESET_INDEX = 0;
export const VDP_XF_PROJECTION_MATRIX_RESET_INDEX = 1;
export const VDP_XF_MATRIX_PACKET_PAYLOAD_WORDS = 1 + VDP_XF_MATRIX_WORDS;
export const VDP_XF_SELECT_PACKET_PAYLOAD_WORDS = 3;

const RESET_ASPECT = 256 / 212;
const RESET_NEAR = 0.1;
const RESET_FAR = 50;
const RESET_FOCAL_Y = 0x0001bb68 / 0x00010000;

function setIdentityWordsAt(out: Uint32Array, base: number): void {
	for (let index = 0; index < VDP_XF_MATRIX_WORDS; index += 1) {
		out[base + index] = 0;
	}
	out[base] = 0x00010000;
	out[base + 5] = 0x00010000;
	out[base + 10] = 0x00010000;
	out[base + 15] = 0x00010000;
}

function setResetProjectionWordsAt(out: Uint32Array, base: number): void {
	const depth = (RESET_FAR + RESET_NEAR) / (RESET_NEAR - RESET_FAR);
	const depthOffset = (2 * RESET_FAR * RESET_NEAR) / (RESET_NEAR - RESET_FAR);
	for (let index = 0; index < VDP_XF_MATRIX_WORDS; index += 1) {
		out[base + index] = 0;
	}
	out[base] = encodeSignedQ16_16(RESET_FOCAL_Y / RESET_ASPECT);
	out[base + 5] = encodeSignedQ16_16(RESET_FOCAL_Y);
	out[base + 10] = encodeSignedQ16_16(depth);
	out[base + 11] = encodeSignedQ16_16(-1);
	out[base + 14] = encodeSignedQ16_16(depthOffset);
}

export class VdpXfUnit {
	public readonly matrixWords = new Uint32Array(VDP_XF_MATRIX_REGISTER_WORDS);
	public viewMatrixIndex = VDP_XF_VIEW_MATRIX_RESET_INDEX;
	public projectionMatrixIndex = VDP_XF_PROJECTION_MATRIX_RESET_INDEX;

	public constructor() {
		this.reset();
	}

	public reset(): void {
		for (let matrixIndex = 0; matrixIndex < VDP_XF_MATRIX_COUNT; matrixIndex += 1) {
			setIdentityWordsAt(this.matrixWords, matrixIndex * VDP_XF_MATRIX_WORDS);
		}
		setResetProjectionWordsAt(this.matrixWords, VDP_XF_PROJECTION_MATRIX_RESET_INDEX * VDP_XF_MATRIX_WORDS);
		this.viewMatrixIndex = VDP_XF_VIEW_MATRIX_RESET_INDEX;
		this.projectionMatrixIndex = VDP_XF_PROJECTION_MATRIX_RESET_INDEX;
	}

	public writeRegister(registerIndex: number, word: number): boolean {
		if (registerIndex < VDP_XF_MATRIX_REGISTER_WORDS) {
			this.matrixWords[registerIndex] = word >>> 0;
			return true;
		}
		if (registerIndex === VDP_XF_VIEW_MATRIX_INDEX_REGISTER) {
			if (word >= VDP_XF_MATRIX_COUNT) {
				return false;
			}
			this.viewMatrixIndex = word >>> 0;
			return true;
		}
		if (registerIndex === VDP_XF_PROJECTION_MATRIX_INDEX_REGISTER) {
			if (word >= VDP_XF_MATRIX_COUNT) {
				return false;
			}
			this.projectionMatrixIndex = word >>> 0;
			return true;
		}
		return false;
	}

	public captureState(): VdpXfState {
		const matrixWords = new Array<number>(VDP_XF_MATRIX_REGISTER_WORDS);
		for (let index = 0; index < VDP_XF_MATRIX_REGISTER_WORDS; index += 1) {
			matrixWords[index] = this.matrixWords[index] >>> 0;
		}
		return {
			matrixWords,
			viewMatrixIndex: this.viewMatrixIndex,
			projectionMatrixIndex: this.projectionMatrixIndex,
		};
	}

	public restoreState(state: VdpXfState): void {
		this.matrixWords.set(state.matrixWords);
		this.viewMatrixIndex = state.viewMatrixIndex;
		this.projectionMatrixIndex = state.projectionMatrixIndex;
	}
}
