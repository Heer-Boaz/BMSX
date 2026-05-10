import { encodeSignedQ16_16 } from './fixed_point';

export type VdpXfState = {
	viewMatrixWords: number[];
	projectionMatrixWords: number[];
};

export const VDP_XF_PACKET_KIND = 0x13000000;
export const VDP_XF_MATRIX_WORDS = 16;
export const VDP_XF_PACKET_PAYLOAD_WORDS = VDP_XF_MATRIX_WORDS * 2;

const RESET_ASPECT = 256 / 212;
const RESET_NEAR = 0.1;
const RESET_FAR = 50;
const RESET_FOCAL_Y = 0x0001bb68 / 0x00010000;

function setIdentityWords(out: Uint32Array): void {
	out.fill(0);
	out[0] = 0x00010000;
	out[5] = 0x00010000;
	out[10] = 0x00010000;
	out[15] = 0x00010000;
}

function setResetProjectionWords(out: Uint32Array): void {
	const depth = (RESET_FAR + RESET_NEAR) / (RESET_NEAR - RESET_FAR);
	const depthOffset = (2 * RESET_FAR * RESET_NEAR) / (RESET_NEAR - RESET_FAR);
	out.fill(0);
	out[0] = encodeSignedQ16_16(RESET_FOCAL_Y / RESET_ASPECT);
	out[5] = encodeSignedQ16_16(RESET_FOCAL_Y);
	out[10] = encodeSignedQ16_16(depth);
	out[11] = encodeSignedQ16_16(-1);
	out[14] = encodeSignedQ16_16(depthOffset);
}

export class VdpXfUnit {
	public readonly viewMatrixWords = new Uint32Array(VDP_XF_MATRIX_WORDS);
	public readonly projectionMatrixWords = new Uint32Array(VDP_XF_MATRIX_WORDS);

	public constructor() {
		this.reset();
	}

	public reset(): void {
		setIdentityWords(this.viewMatrixWords);
		setResetProjectionWords(this.projectionMatrixWords);
	}

	public captureState(): VdpXfState {
		const viewMatrixWords = new Array<number>(VDP_XF_MATRIX_WORDS);
		const projectionMatrixWords = new Array<number>(VDP_XF_MATRIX_WORDS);
		for (let index = 0; index < VDP_XF_MATRIX_WORDS; index += 1) {
			viewMatrixWords[index] = this.viewMatrixWords[index] >>> 0;
			projectionMatrixWords[index] = this.projectionMatrixWords[index] >>> 0;
		}
		return {
			viewMatrixWords,
			projectionMatrixWords,
		};
	}

	public restoreState(state: VdpXfState): void {
		if (state.viewMatrixWords.length !== VDP_XF_MATRIX_WORDS || state.projectionMatrixWords.length !== VDP_XF_MATRIX_WORDS) {
			throw new Error(`[VDP] XF state requires ${VDP_XF_MATRIX_WORDS} view and projection words.`);
		}
		this.viewMatrixWords.set(state.viewMatrixWords);
		this.projectionMatrixWords.set(state.projectionMatrixWords);
	}
}
