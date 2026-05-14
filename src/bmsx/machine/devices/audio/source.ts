import { Memory } from '../../memory/memory';
import {
	APU_FAULT_NONE,
	APU_FAULT_SOURCE_BYTES,
	APU_FAULT_SOURCE_RANGE,
	APU_SLOT_COUNT,
	apuAudioSourceUsesGenerator,
	type ApuAudioSlot,
	type ApuAudioSource,
} from './contracts';

export type ApuSourceDmaResult = {
	faultCode: number;
	faultDetail: number;
};

const APU_SOURCE_DMA_OK: ApuSourceDmaResult = { faultCode: APU_FAULT_NONE, faultDetail: 0 };
const EMPTY_APU_SOURCE_BYTES = new Uint8Array(0);

export class ApuSourceDma {
	private readonly slotSourceBytes: Uint8Array[] = new Array(APU_SLOT_COUNT).fill(EMPTY_APU_SOURCE_BYTES);

	public constructor(private readonly memory: Memory) {}

	public reset(): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slotSourceBytes[slot] = EMPTY_APU_SOURCE_BYTES;
		}
	}

	public captureState(): Uint8Array[] {
		const state = new Array<Uint8Array>(APU_SLOT_COUNT);
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			state[slot] = this.slotSourceBytes[slot]!.slice();
		}
		return state;
	}

	public restoreState(slotSourceBytes: readonly Uint8Array[]): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slotSourceBytes[slot] = slotSourceBytes[slot]!.slice();
		}
	}

	public bytesForSlot(slot: ApuAudioSlot): Uint8Array {
		return this.slotSourceBytes[slot]!;
	}

	public clearSlot(slot: ApuAudioSlot): void {
		this.slotSourceBytes[slot] = EMPTY_APU_SOURCE_BYTES;
	}

	public loadSlot(slot: ApuAudioSlot, source: ApuAudioSource): ApuSourceDmaResult {
		if (apuAudioSourceUsesGenerator(source)) {
			this.clearSlot(slot);
			return APU_SOURCE_DMA_OK;
		}
		const validation = this.validateSource(source);
		if (validation.faultCode !== APU_FAULT_NONE) {
			return validation;
		}
		let bytes = this.slotSourceBytes[slot]!;
		if (bytes.byteLength !== source.sourceBytes) {
			bytes = new Uint8Array(source.sourceBytes);
			this.slotSourceBytes[slot] = bytes;
		}
		this.memory.readBytesInto(source.sourceAddr, bytes, bytes.byteLength);
		return APU_SOURCE_DMA_OK;
	}

	private validateSource(source: ApuAudioSource): ApuSourceDmaResult {
		if (source.sourceBytes === 0) {
			return { faultCode: APU_FAULT_SOURCE_BYTES, faultDetail: source.sourceBytes };
		}
		if (!this.memory.isReadableMainMemoryRange(source.sourceAddr, source.sourceBytes)) {
			return { faultCode: APU_FAULT_SOURCE_RANGE, faultDetail: source.sourceAddr };
		}
		return APU_SOURCE_DMA_OK;
	}
}
