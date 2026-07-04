import { Memory, type MainMemoryByteView } from '../../memory/memory';
import {
	APU_GENERATOR_NONE,
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
	APU_SLOT_COUNT,
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
} from './contracts';

const EMPTY_APU_SOURCE_BYTES = new Uint8Array(0);

export type ApuSourceByteView = MainMemoryByteView;

class ApuSlotSource {
	public ownedBytes: Uint8Array = EMPTY_APU_SOURCE_BYTES;
	public readonly bytes: ApuSourceByteView = { bytes: EMPTY_APU_SOURCE_BYTES, byteOffset: 0, byteLength: 0 };

	public bindOwnedBytes(bytes: Uint8Array): void {
		this.ownedBytes = bytes;
		this.bytes.bytes = bytes;
		this.bytes.byteOffset = 0;
		this.bytes.byteLength = bytes.byteLength;
	}
}

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

export class ApuSourceDma {
	private readonly slotSources: ApuSlotSource[] = new Array(APU_SLOT_COUNT);

	public constructor(private readonly memory: Memory) {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slotSources[slot] = new ApuSlotSource();
		}
	}

	public reset(): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.clearSlot(slot);
		}
	}

	public captureState(): Uint8Array[] {
		const state = new Array<Uint8Array>(APU_SLOT_COUNT);
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const sourceBytes = this.slotSources[slot]!.bytes;
			state[slot] = sourceBytes.bytes.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
		}
		return state;
	}

	public restoreState(slotSourceBytes: readonly Uint8Array[]): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const bytes = slotSourceBytes[slot]!.slice();
			this.slotSources[slot]!.bindOwnedBytes(bytes);
		}
	}

	public bytesForSlot(slot: ApuAudioSlot): ApuSourceByteView {
		return this.slotSources[slot]!.bytes;
	}

	public clearSlot(slot: ApuAudioSlot): void {
		const slotSource = this.slotSources[slot]!;
		slotSource.ownedBytes = EMPTY_APU_SOURCE_BYTES;
		slotSource.bytes.bytes = EMPTY_APU_SOURCE_BYTES;
		slotSource.bytes.byteOffset = 0;
		slotSource.bytes.byteLength = 0;
	}

	public loadSlot(slot: ApuAudioSlot, source: ApuAudioSource): void {
		if (apuAudioSourceUsesGenerator(source)) {
			this.clearSlot(slot);
			return;
		}
		const slotSource = this.slotSources[slot]!;
		if (this.memory.bindImmutableMainMemoryView(source.sourceAddr, source.sourceBytes, slotSource.bytes)) {
			slotSource.ownedBytes = EMPTY_APU_SOURCE_BYTES;
			return;
		}
		let bytes = slotSource.ownedBytes;
		if (bytes.byteLength !== source.sourceBytes) {
			bytes = new Uint8Array(source.sourceBytes);
		}
		this.memory.readBytesInto(source.sourceAddr, bytes, bytes.byteLength);
		slotSource.bindOwnedBytes(bytes);
	}
}
