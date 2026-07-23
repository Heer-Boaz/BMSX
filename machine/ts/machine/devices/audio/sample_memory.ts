import { readLE32, writeLE32 } from '../../../common/endian';
import type { Memory, RomByteView } from '../../memory/memory';
import {
	APU_SAMPLE_RAM_ADDRESS_MASK,
	APU_SAMPLE_RAM_BASE,
	APU_SAMPLE_RAM_BYTES,
} from './contracts';
import type { ApuSourceByteView } from './source';

export class ApuSampleMemory {
	private readonly ram = new Uint8Array(APU_SAMPLE_RAM_BYTES);
	private readonly romView: RomByteView = { bytes: this.ram, byteOffset: 0, byteLength: 0 };

	public constructor(private readonly memory: Memory) {}

	public reset(): void {
		this.ram.fill(0);
	}

	public bindSource(addr: number, byteLength: number, cartridgeSlot: number, out: ApuSourceByteView): boolean {
		if (byteLength !== 0 && addr >= APU_SAMPLE_RAM_BASE) {
			const offset = addr - APU_SAMPLE_RAM_BASE;
			if (offset + byteLength <= APU_SAMPLE_RAM_BYTES) {
				out.bytes = this.ram;
				out.byteOffset = offset;
				out.byteLength = byteLength;
				out.cartridgeSlot = cartridgeSlot;
				return true;
			}
		}
		if (this.memory.bindRomByteView(addr, byteLength, cartridgeSlot, this.romView)) {
			out.bytes = this.romView.bytes;
			out.byteOffset = this.romView.byteOffset;
			out.byteLength = this.romView.byteLength;
			out.cartridgeSlot = cartridgeSlot;
			return true;
		}
		return false;
	}

	public readWord(address: number): number {
		return readLE32(this.ram, address & (APU_SAMPLE_RAM_ADDRESS_MASK & ~3));
	}

	public writeWord(address: number, word: number): void {
		writeLE32(this.ram, address & (APU_SAMPLE_RAM_ADDRESS_MASK & ~3), word);
	}

	public captureState(): Uint8Array {
		return this.ram.slice();
	}

	public restoreState(bytes: Uint8Array): void {
		this.ram.set(bytes);
	}
}
