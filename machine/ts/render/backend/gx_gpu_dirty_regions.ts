import { GX_GPU_VRAM_X_ADDRESS_PERIOD, GX_GPU_VRAM_Y_ADDRESS_PERIOD, gxGpuVramYAddressMask } from '../../spec/gx/vram';
import { gxGpuVramWrappedHeight, gxGpuVramWrappedWidth } from './gx_gpu_render_rules';

const CELL_SHIFT = 4;
const CELL_SIZE = 1 << CELL_SHIFT;

// Mirrors the native physical-VRAM dirty map. Consume copies whole 16x16-word
// cells; backing surfaces must own those cells, including their untouched words.
export class GxGpuDirtyRegions {
	private readonly rows = new Uint32Array((GX_GPU_VRAM_Y_ADDRESS_PERIOD >> CELL_SHIFT) * 2);

	clear(): void { this.rows.fill(0); }

	mark(left: number, top: number, right: number, bottom: number): void {
		if (right <= left || bottom <= top) return;
		const first = left >>> CELL_SHIFT;
		const last = (right + CELL_SIZE - 1) >>> CELL_SHIFT;
		const low = columnMask(first, last, 0), high = columnMask(first, last, 1);
		const endRow = (bottom + CELL_SIZE - 1) >>> CELL_SHIFT;
		for (let row = top >>> CELL_SHIFT; row < endRow; ++row) {
			this.rows[row * 2] |= low;
			this.rows[row * 2 + 1] |= high;
		}
	}

	// Logical reads wrap through both the guest Y gate and installed physical rows.
	markLogical(x: number, y: number, width: number, height: number, vramYAddressExtensionWord: number, physicalRowMask: number): void {
		const yMask = gxGpuVramYAddressMask(vramYAddressExtensionWord) & physicalRowMask;
		let row = y & yMask;
		while (height !== 0) {
			const rows = gxGpuVramWrappedHeight(row, height, vramYAddressExtensionWord, physicalRowMask);
			let column = x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1), remainingWidth = width;
			while (remainingWidth !== 0) {
				const columns = gxGpuVramWrappedWidth(column, remainingWidth);
				this.mark(column, row, column + columns, row + rows);
				column = 0;
				remainingWidth -= columns;
			}
			row = 0;
			height -= rows;
		}
	}

	consume<T>(left: number, top: number, right: number, bottom: number, context: T,
		copy: (context: T, left: number, top: number, right: number, bottom: number) => void): boolean {
		if (right <= left || bottom <= top) return false;
		const first = left >>> CELL_SHIFT;
		const last = (right + CELL_SIZE - 1) >>> CELL_SHIFT;
		const queryLow = columnMask(first, last, 0), queryHigh = columnMask(first, last, 1);
		const endRow = (bottom + CELL_SIZE - 1) >>> CELL_SHIFT;
		let copied = false;
		for (let row = top >>> CELL_SHIFT; row < endRow; ++row) {
			for (;;) {
				const low = this.rows[row * 2] & queryLow, high = this.rows[row * 2 + 1] & queryHigh;
				if ((low | high) === 0) break;
				const start = low !== 0 ? 31 - Math.clz32(low & -low) : 63 - Math.clz32(high & -high);
				let end = start + trailingOnes(this.rows[row * 2 + (start >>> 5)] >>> (start & 31));
				if (end === 32 && last > 32) end += trailingOnes(this.rows[row * 2 + 1]);
				end = Math.min(end, last);
				const runLow = columnMask(start, end, 0), runHigh = columnMask(start, end, 1);
				let next = row;
				do {
					this.rows[next * 2] &= ~runLow;
					this.rows[next * 2 + 1] &= ~runHigh;
					++next;
				} while (next < endRow && ((this.rows[next * 2] & runLow) >>> 0) === runLow
					&& ((this.rows[next * 2 + 1] & runHigh) >>> 0) === runHigh);
				copy(context, start << CELL_SHIFT, row << CELL_SHIFT, end << CELL_SHIFT, next << CELL_SHIFT);
				copied = true;
			}
		}
		return copied;
	}
}

function columnMask(first: number, last: number, half: number): number {
	const begin = Math.max(first - half * 32, 0);
	const end = Math.min(last - half * 32, 32);
	return end <= begin ? 0 : ((0xffffffff >>> (32 - (end - begin))) << begin) >>> 0;
}

function trailingOnes(word: number): number {
	const inverted = ~word;
	return inverted === 0 ? 32 : 31 - Math.clz32(inverted & -inverted);
}
