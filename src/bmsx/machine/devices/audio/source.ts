import { Memory } from '../../memory/memory';
import {
	APU_FAULT_NONE,
	APU_FAULT_OUTPUT_METADATA,
	APU_FAULT_SOURCE_BIT_DEPTH,
	APU_FAULT_SOURCE_CHANNELS,
	APU_FAULT_SOURCE_DATA_RANGE,
	APU_FAULT_SOURCE_FRAME_COUNT,
	APU_FAULT_SOURCE_SAMPLE_RATE,
	APU_GENERATOR_NONE,
	APU_GENERATOR_SQUARE,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_BYTES_INDEX,
	APU_PARAMETER_SOURCE_CHANNELS_INDEX,
	APU_PARAMETER_SOURCE_DATA_BYTES_INDEX,
	APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX,
	APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX,
	APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_GENERATOR_KIND_INDEX,
	APU_FAULT_SOURCE_BYTES,
	APU_FAULT_SOURCE_RANGE,
	APU_SLOT_COUNT,
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
} from './contracts';

export type ApuSourceDmaResult = {
	faultCode: number;
	faultDetail: number;
};

export type ApuSourceMetadataResult = {
	faultCode: number;
	faultDetail: number;
};

const APU_SOURCE_DMA_OK: ApuSourceDmaResult = { faultCode: APU_FAULT_NONE, faultDetail: 0 };
const APU_SOURCE_METADATA_OK: ApuSourceMetadataResult = { faultCode: APU_FAULT_NONE, faultDetail: 0 };
const EMPTY_APU_SOURCE_BYTES = new Uint8Array(0);

export function resolveApuAudioSource(registerWords: ApuParameterRegisterWords): ApuAudioSource {
	return {
		sourceAddr: registerWords[APU_PARAMETER_SOURCE_ADDR_INDEX]!,
		sourceBytes: registerWords[APU_PARAMETER_SOURCE_BYTES_INDEX]!,
		sampleRateHz: registerWords[APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX]!,
		channels: registerWords[APU_PARAMETER_SOURCE_CHANNELS_INDEX]!,
		bitsPerSample: registerWords[APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX]!,
		frameCount: registerWords[APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX]!,
		dataOffset: registerWords[APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX]!,
		dataBytes: registerWords[APU_PARAMETER_SOURCE_DATA_BYTES_INDEX]!,
		loopStartSample: registerWords[APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX]!,
		loopEndSample: registerWords[APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX]!,
		generatorKind: registerWords[APU_PARAMETER_GENERATOR_KIND_INDEX]!,
		generatorDutyQ12: registerWords[APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX]!,
	};
}

export function apuAudioSourceUsesGenerator(source: ApuAudioSource): boolean {
	return source.generatorKind !== APU_GENERATOR_NONE;
}

export function apuParameterProgramsSourceBuffer(parameterIndex: number): boolean {
	switch (parameterIndex) {
		case APU_PARAMETER_SOURCE_ADDR_INDEX:
		case APU_PARAMETER_SOURCE_BYTES_INDEX:
		case APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX:
		case APU_PARAMETER_SOURCE_CHANNELS_INDEX:
		case APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX:
		case APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX:
		case APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX:
		case APU_PARAMETER_SOURCE_DATA_BYTES_INDEX:
		case APU_PARAMETER_GENERATOR_KIND_INDEX:
			return true;
		default:
			return false;
	}
}

export function validateApuAudioSourceMetadata(source: ApuAudioSource): ApuSourceMetadataResult {
	if (source.sampleRateHz === 0) {
		return { faultCode: APU_FAULT_SOURCE_SAMPLE_RATE, faultDetail: source.sampleRateHz };
	}
	if (source.channels < 1 || source.channels > 2) {
		return { faultCode: APU_FAULT_SOURCE_CHANNELS, faultDetail: source.channels };
	}
	if (source.frameCount === 0) {
		return { faultCode: APU_FAULT_SOURCE_FRAME_COUNT, faultDetail: source.frameCount };
	}
	if (apuAudioSourceUsesGenerator(source)) {
		if (source.generatorKind === APU_GENERATOR_SQUARE) {
			return APU_SOURCE_METADATA_OK;
		}
		return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: source.generatorKind };
	}
	if (source.dataBytes === 0 || source.dataOffset > source.sourceBytes || source.dataBytes > source.sourceBytes - source.dataOffset) {
		return { faultCode: APU_FAULT_SOURCE_DATA_RANGE, faultDetail: source.dataOffset };
	}
	switch (source.bitsPerSample) {
		case 4:
		case 8:
		case 16:
			return APU_SOURCE_METADATA_OK;
	}
	return { faultCode: APU_FAULT_SOURCE_BIT_DEPTH, faultDetail: source.bitsPerSample };
}

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
