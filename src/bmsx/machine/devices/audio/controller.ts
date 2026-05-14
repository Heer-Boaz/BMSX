import type { AudioSlot, SoundMaster, SoundMasterAudioSource, SoundMasterResolvedPlayRequest, VoiceId } from '../../../audio/soundmaster';
import {
	APU_GAIN_Q12_ONE,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RATE_HZ,
	APU_CMD_NONE,
	APU_CMD_PLAY,
	APU_CMD_RAMP_SLOT,
	APU_CMD_STOP_SLOT,
	APU_EVENT_NONE,
	APU_EVENT_SLOT_ENDED,
	APU_FAULT_BAD_CMD,
	APU_FAULT_BAD_SLOT,
	APU_FAULT_NONE,
	APU_FAULT_PLAYBACK_REJECTED,
	APU_FAULT_RUNTIME_UNAVAILABLE,
	APU_FAULT_SOURCE_BIT_DEPTH,
	APU_FAULT_SOURCE_BYTES,
	APU_FAULT_SOURCE_CHANNELS,
	APU_FAULT_SOURCE_DATA_RANGE,
	APU_FAULT_SOURCE_FRAME_COUNT,
	APU_FAULT_SOURCE_RANGE,
	APU_FAULT_SOURCE_SAMPLE_RATE,
	APU_FILTER_ALLPASS,
	APU_FILTER_BANDPASS,
	APU_FILTER_HIGHPASS,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWPASS,
	APU_FILTER_LOWSHELF,
	APU_FILTER_NONE,
	APU_FILTER_NOTCH,
	APU_FILTER_PEAKING,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SLOT_COUNT,
	APU_SLOT_REGISTER_WORD_COUNT,
	APU_STATUS_BUSY,
	APU_STATUS_FAULT,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
	apuSlotRegisterWordIndex,
} from './contracts';
import {
	IO_APU_CMD,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_ACTIVE_MASK,
	IO_APU_FADE_SAMPLES,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_PARAMETER_REGISTER_ADDRS,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SELECTED_SOURCE_ADDR,
	IO_APU_SELECTED_SLOT_REG0,
	IO_APU_SLOT,
	IO_APU_START_SAMPLE,
	IO_APU_STATUS,
	IO_APU_SOURCE_ADDR,
	IO_APU_SOURCE_BITS_PER_SAMPLE,
	IO_APU_SOURCE_BYTES,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_DATA_BYTES,
	IO_APU_SOURCE_DATA_OFFSET,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_LOOP_START_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_APU_TARGET_GAIN_Q12,
	IO_ARG_STRIDE,
	IRQ_APU,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import { DeviceStatusLatch, type DeviceStatusRegisters } from '../device_status';
import type { IrqController } from '../irq/controller';

export type AudioControllerState = {
	registerWords: number[];
	eventSequence: number;
	eventKind: number;
	eventSlot: number;
	eventSourceAddr: number;
	activeSlotMask: number;
	slotRegisterWords: number[];
	apuStatus: number;
	apuFaultCode: number;
	apuFaultDetail: number;
};

const APU_DEVICE_STATUS_REGISTERS: DeviceStatusRegisters = {
	statusAddr: IO_APU_STATUS,
	codeAddr: IO_APU_FAULT_CODE,
	detailAddr: IO_APU_FAULT_DETAIL,
	ackAddr: IO_APU_FAULT_ACK,
	faultMask: APU_STATUS_FAULT,
	noneCode: APU_FAULT_NONE,
};

function apuSamplesToMilliseconds(samples: number): number {
	const scaled = samples * 1000;
	return (scaled - (scaled % APU_SAMPLE_RATE_HZ)) / APU_SAMPLE_RATE_HZ;
}

function decodeFilterKind(kind: number): BiquadFilterType {
	switch (kind) {
		case APU_FILTER_HIGHPASS:
			return 'highpass';
		case APU_FILTER_BANDPASS:
			return 'bandpass';
		case APU_FILTER_NOTCH:
			return 'notch';
		case APU_FILTER_ALLPASS:
			return 'allpass';
		case APU_FILTER_PEAKING:
			return 'peaking';
		case APU_FILTER_LOWSHELF:
			return 'lowshelf';
		case APU_FILTER_HIGHSHELF:
			return 'highshelf';
		case APU_FILTER_LOWPASS:
		default:
			return 'lowpass';
	}
}

export class AudioController {
	private eventSequence = 0;
	private pendingSlotMask = 0;
	private activeSlotMask = 0;
	private readonly slotPlayGenerations = new Array<number>(APU_SLOT_COUNT).fill(0);
	private readonly slotRegisterWords = new Uint32Array(APU_SLOT_REGISTER_WORD_COUNT);
	private readonly slotVoiceIds: VoiceId[] = new Array(APU_SLOT_COUNT).fill(0);
	private readonly fault: DeviceStatusLatch;
	private endedUnsubscribe: (() => void) | null = null;

	public constructor(
		private readonly memory: Memory,
		private readonly soundMaster: SoundMaster,
		private readonly irq: IrqController,
	) {
		this.fault = new DeviceStatusLatch(memory, APU_DEVICE_STATUS_REGISTERS);
		this.memory.mapIoRead(IO_APU_STATUS, this.onStatusRead.bind(this));
		this.memory.mapIoWrite(IO_APU_CMD, this.onCommandWrite.bind(this));
		this.memory.mapIoWrite(IO_APU_SLOT, this.updateSelectedSlotActiveStatus.bind(this));
		this.memory.mapIoWrite(IO_APU_FAULT_ACK, () => {
			this.fault.acknowledge();
		});
		const selectedSlotRegisterRead = this.onSelectedSlotRegisterRead.bind(this);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.memory.mapIoRead(IO_APU_SELECTED_SLOT_REG0 + index * IO_ARG_STRIDE, selectedSlotRegisterRead);
		}
		this.endedUnsubscribe = this.soundMaster.addEndedListener((info) => {
			this.emitSlotEvent(APU_EVENT_SLOT_ENDED, info.slot, info.voiceId, info.sourceAddr);
		});
	}

	public dispose(): void {
		const endedUnsubscribe = this.endedUnsubscribe;
		if (endedUnsubscribe === null) {
			return;
		}
		this.endedUnsubscribe = null;
		endedUnsubscribe();
	}

	public reset(): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slotPlayGenerations[slot] += 1;
		}
		this.eventSequence = 0;
		this.pendingSlotMask = 0;
		this.activeSlotMask = 0;
		this.slotRegisterWords.fill(0);
		this.slotVoiceIds.fill(0);
		this.soundMaster.stopAllVoices();
		this.fault.resetStatus();
		this.clearCommandLatch();
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_SLOT, 0);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
		this.memory.writeValue(IO_APU_SELECTED_SOURCE_ADDR, 0);
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, 0);
	}

	public captureState(): AudioControllerState {
		const registerWords = new Array<number>(APU_PARAMETER_REGISTER_COUNT);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			registerWords[index] = this.memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]!);
		}
		return {
			registerWords,
			eventSequence: this.eventSequence,
			eventKind: this.memory.readIoU32(IO_APU_EVENT_KIND),
			eventSlot: this.memory.readIoU32(IO_APU_EVENT_SLOT),
			eventSourceAddr: this.memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR),
			activeSlotMask: this.activeSlotMask,
			slotRegisterWords: Array.from(this.slotRegisterWords),
			apuStatus: this.fault.status,
			apuFaultCode: this.fault.code,
			apuFaultDetail: this.fault.detail,
		};
	}

	public restoreState(state: AudioControllerState): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slotPlayGenerations[slot] += 1;
		}
		this.pendingSlotMask = 0;
		this.slotVoiceIds.fill(0);
		this.soundMaster.stopAllVoices();
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_APU_PARAMETER_REGISTER_ADDRS[index]!, state.registerWords[index]!);
		}
		this.eventSequence = state.eventSequence >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, state.eventKind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, state.eventSlot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, state.eventSourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.activeSlotMask = state.activeSlotMask >>> 0;
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.activeSlotMask);
		for (let index = 0; index < APU_SLOT_REGISTER_WORD_COUNT; index += 1) {
			this.slotRegisterWords[index] = state.slotRegisterWords[index] >>> 0;
		}
		this.fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
		this.updateSelectedSlotActiveStatus();
	}

	private resetCommandLatch(): void {
		this.memory.writeValue(IO_APU_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_SOURCE_BYTES, 0);
		this.memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, 0);
		this.memory.writeValue(IO_APU_SOURCE_CHANNELS, 0);
		this.memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 0);
		this.memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 0);
		this.memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 0);
		this.memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SLOT, 0);
		this.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
		this.memory.writeValue(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
		this.memory.writeValue(IO_APU_START_SAMPLE, 0);
		this.memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_NONE);
		this.memory.writeValue(IO_APU_FILTER_FREQ_HZ, 0);
		this.memory.writeValue(IO_APU_FILTER_Q_MILLI, 1000);
		this.memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, 0);
		this.memory.writeValue(IO_APU_FADE_SAMPLES, 0);
		this.memory.writeValue(IO_APU_TARGET_GAIN_Q12, APU_GAIN_Q12_ONE);
	}

	private clearCommandLatch(): void {
		this.resetCommandLatch();
		this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
	}

	public onCommandWrite(): void {
		const command = this.memory.readIoU32(IO_APU_CMD);
		switch (command) {
			case APU_CMD_PLAY:
				this.play();
				this.clearCommandLatch();
				return;
			case APU_CMD_STOP_SLOT:
				this.stopSlot();
				this.clearCommandLatch();
				return;
			case APU_CMD_RAMP_SLOT:
				this.rampSlot();
				this.clearCommandLatch();
				return;
			case APU_CMD_NONE:
				return;
			default:
				this.fault.raise(APU_FAULT_BAD_CMD, command);
				this.clearCommandLatch();
				return;
		}
	}

	private readSlot(): AudioSlot | undefined {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		if (slot >= APU_SLOT_COUNT) {
			this.fault.raise(APU_FAULT_BAD_SLOT, slot);
			return undefined;
		}
		return slot;
	}

	private play(): void {
		const source = this.readAudioSource();
		if (source === undefined) {
			return;
		}
		const slot = this.readSlot();
		if (slot === undefined) {
			return;
		}
		this.startPlay(source, slot, this.readResolvedPlayRequest(source), this.captureParameterRegisterWords());
	}

	private captureParameterRegisterWords(): number[] {
		const words = new Array<number>(APU_PARAMETER_REGISTER_COUNT);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			words[index] = this.memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]!);
		}
		return words;
	}

	private readAudioSource(): SoundMasterAudioSource | undefined {
		const source: SoundMasterAudioSource = {
			sourceAddr: this.memory.readIoU32(IO_APU_SOURCE_ADDR),
			sourceBytes: this.memory.readIoU32(IO_APU_SOURCE_BYTES),
			sampleRateHz: this.memory.readIoU32(IO_APU_SOURCE_SAMPLE_RATE_HZ),
			channels: this.memory.readIoU32(IO_APU_SOURCE_CHANNELS),
			bitsPerSample: this.memory.readIoU32(IO_APU_SOURCE_BITS_PER_SAMPLE),
			frameCount: this.memory.readIoU32(IO_APU_SOURCE_FRAME_COUNT),
			dataOffset: this.memory.readIoU32(IO_APU_SOURCE_DATA_OFFSET),
			dataBytes: this.memory.readIoU32(IO_APU_SOURCE_DATA_BYTES),
			loopStartSample: this.memory.readIoU32(IO_APU_SOURCE_LOOP_START_SAMPLE),
			loopEndSample: this.memory.readIoU32(IO_APU_SOURCE_LOOP_END_SAMPLE),
		};
		if (source.sourceBytes === 0) {
			this.fault.raise(APU_FAULT_SOURCE_BYTES, source.sourceBytes);
			return undefined;
		}
		if (!this.memory.isReadableMainMemoryRange(source.sourceAddr, source.sourceBytes)) {
			this.fault.raise(APU_FAULT_SOURCE_RANGE, source.sourceAddr);
			return undefined;
		}
		if (source.sampleRateHz === 0) {
			this.fault.raise(APU_FAULT_SOURCE_SAMPLE_RATE, source.sampleRateHz);
			return undefined;
		}
		if (source.channels < 1 || source.channels > 2) {
			this.fault.raise(APU_FAULT_SOURCE_CHANNELS, source.channels);
			return undefined;
		}
		if (source.frameCount === 0) {
			this.fault.raise(APU_FAULT_SOURCE_FRAME_COUNT, source.frameCount);
			return undefined;
		}
		if (source.dataBytes === 0 || source.dataOffset + source.dataBytes > source.sourceBytes) {
			this.fault.raise(APU_FAULT_SOURCE_DATA_RANGE, source.dataOffset);
			return undefined;
		}
		switch (source.bitsPerSample) {
			case 4:
			case 8:
			case 16:
				return source;
		}
		this.fault.raise(APU_FAULT_SOURCE_BIT_DEPTH, source.bitsPerSample);
		return undefined;
	}

	private startPlay(source: SoundMasterAudioSource, slot: AudioSlot, request: SoundMasterResolvedPlayRequest, registerWords: number[]): void {
		if (!this.soundMaster.isRuntimeAudioReady()) {
			this.fault.raise(APU_FAULT_RUNTIME_UNAVAILABLE, source.sourceAddr);
			return;
		}
		const bytes = new Uint8Array(source.sourceBytes);
		this.memory.readBytesInto(source.sourceAddr, bytes, bytes.byteLength);
		const bit = 1 << slot;
		const playGeneration = this.slotPlayGenerations[slot] + 1;
		this.slotPlayGenerations[slot] = playGeneration;
		this.pendingSlotMask = (this.pendingSlotMask | bit) >>> 0;
		void this.soundMaster.playResolvedSourceOnSlot(slot, source, bytes, request).then((voiceId) => {
			if (playGeneration !== this.slotPlayGenerations[slot]) {
				return;
			}
			this.pendingSlotMask = (this.pendingSlotMask & ~bit) >>> 0;
			if (voiceId === 0) {
				return;
			}
			this.setSlotActive(slot, registerWords, voiceId);
		}, () => {
			if (playGeneration !== this.slotPlayGenerations[slot]) {
				return;
			}
			this.pendingSlotMask = (this.pendingSlotMask & ~bit) >>> 0;
			this.fault.raise(APU_FAULT_PLAYBACK_REJECTED, source.sourceAddr);
		});
	}

	private stopSlot(): void {
		const slot = this.readSlot();
		if (slot === undefined) {
			return;
		}
		const bit = 1 << slot;
		this.slotPlayGenerations[slot] += 1;
		this.pendingSlotMask = (this.pendingSlotMask & ~bit) >>> 0;
		const fadeSamples = this.memory.readIoU32(IO_APU_FADE_SAMPLES);
		const stopped = this.soundMaster.stopSlot(slot, fadeSamples > 0 ? apuSamplesToMilliseconds(fadeSamples) : undefined);
		if (!stopped) {
			this.stopSlotActive(slot);
		}
	}

	private rampSlot(): void {
		const slot = this.readSlot();
		if (slot === undefined) {
			return;
		}
		const targetGain = this.memory.readIoI32(IO_APU_TARGET_GAIN_Q12) / APU_GAIN_Q12_ONE;
		const fadeSamples = this.memory.readIoU32(IO_APU_FADE_SAMPLES);
		if (fadeSamples > 0) {
			this.soundMaster.rampSlotGainLinear(slot, targetGain, fadeSamples / APU_SAMPLE_RATE_HZ);
			return;
		}
		this.soundMaster.setSlotGainLinear(slot, targetGain);
	}

	private readResolvedPlayRequest(source: SoundMasterAudioSource): SoundMasterResolvedPlayRequest {
		const rateStepQ16 = this.memory.readIoI32(IO_APU_RATE_STEP_Q16);
		const gainQ12 = this.memory.readIoI32(IO_APU_GAIN_Q12);
		const startSample = this.memory.readIoU32(IO_APU_START_SAMPLE);
		const filterKind = this.memory.readIoU32(IO_APU_FILTER_KIND);
		const request: SoundMasterResolvedPlayRequest = {
			playbackRate: rateStepQ16 / APU_RATE_STEP_Q16_ONE,
			gainLinear: gainQ12 / APU_GAIN_Q12_ONE,
			offsetSeconds: startSample / source.sampleRateHz,
			filter: null,
		};
		if (filterKind !== APU_FILTER_NONE) {
			request.filter = {
				type: decodeFilterKind(filterKind),
				frequency: this.memory.readIoI32(IO_APU_FILTER_FREQ_HZ),
				q: this.memory.readIoI32(IO_APU_FILTER_Q_MILLI) / 1000,
				gain: this.memory.readIoI32(IO_APU_FILTER_GAIN_MILLIDB) / 1000,
			};
		}
		return request;
	}

	private emitSlotEvent(kind: number, slot: AudioSlot, voiceId: VoiceId, sourceAddr: number): void {
		if (this.slotVoiceIds[slot] !== voiceId) {
			return;
		}
		this.stopSlotActive(slot);
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, kind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, slot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, sourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}

	private setSlotActive(slot: AudioSlot, registerWords: number[], voiceId: VoiceId): void {
		const bit = 1 << slot;
		this.pendingSlotMask = (this.pendingSlotMask & ~bit) >>> 0;
		this.activeSlotMask = (this.activeSlotMask | bit) >>> 0;
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.activeSlotMask);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = registerWords[index] >>> 0;
		}
		this.slotVoiceIds[slot] = voiceId;
		this.updateSelectedSlotActiveStatus();
	}

	private stopSlotActive(slot: AudioSlot): void {
		const bit = 1 << slot;
		this.activeSlotMask = (this.activeSlotMask & ~bit) >>> 0;
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.activeSlotMask);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = 0;
		}
		this.slotVoiceIds[slot] = 0;
		this.updateSelectedSlotActiveStatus();
	}

	private updateSelectedSlotActiveStatus(): void {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		const active = slot < APU_SLOT_COUNT && (this.activeSlotMask & (1 << slot)) !== 0;
		this.memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, active ? this.slotRegisterWords[apuSlotRegisterWordIndex(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)] : 0);
		this.fault.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
	}

	private onStatusRead(): number {
		const busy = (this.activeSlotMask | this.pendingSlotMask) !== 0;
		return (this.fault.status | (busy ? APU_STATUS_BUSY : 0)) >>> 0;
	}

	private onSelectedSlotRegisterRead(addr: number): number {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		const active = slot < APU_SLOT_COUNT && (this.activeSlotMask & (1 << slot)) !== 0;
		if (!active) {
			return 0;
		}
		const parameterIndex = (addr - IO_APU_SELECTED_SLOT_REG0) / IO_ARG_STRIDE;
		return this.slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)]!;
	}

}
