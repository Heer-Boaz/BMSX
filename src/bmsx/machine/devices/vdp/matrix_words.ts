export const VDP_MATRIX_WORD_COUNT = 16;
export const VDP_MATRIX_Q16_ONE = 0x00010000;

export function setIdentityMatrixWordsAt(out: Uint32Array, base: number): void {
	for (let index = 0; index < VDP_MATRIX_WORD_COUNT; index += 1) {
		out[base + index] = 0;
	}
	out[base] = VDP_MATRIX_Q16_ONE;
	out[base + 5] = VDP_MATRIX_Q16_ONE;
	out[base + 10] = VDP_MATRIX_Q16_ONE;
	out[base + 15] = VDP_MATRIX_Q16_ONE;
}
