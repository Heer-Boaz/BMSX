import type { AudioSlot, SoundMaster, SoundMasterAudioSource, SoundMasterResolvedPlayRequest } from '../../../audio/soundmaster';
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
	APU_SLOT_COUNT,
	APU_STATUS_FAULT,
	IO_APU_CMD,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_FADE_SAMPLES,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_RATE_STEP_Q16,
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
	IRQ_APU,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import { DeviceStatusLatch, type DeviceStatusRegisters } from '../device_status';
import type { IrqController } from '../irq/controller';

export type AudioControllerState = {
	eventSequence: number;
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
	return Math.floor((samples * 1000) / APU_SAMPLE_RATE_HZ);
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
	private readonly fault: DeviceStatusLatch;
	private endedUnsubscribe: (() => void) | null = null;

	public constructor(
		private readonly memory: Memory,
		private readonly soundMaster: SoundMaster,
		private readonly irq: IrqController,
	) {
		this.fault = new DeviceStatusLatch(memory, APU_DEVICE_STATUS_REGISTERS);
		this.memory.mapIoWrite(IO_APU_CMD, this.onCommandWrite.bind(this));
		this.memory.mapIoWrite(IO_APU_FAULT_ACK, () => {
			this.fault.acknowledge();
		});
		this.endedUnsubscribe = this.soundMaster.addEndedListener((info) => {
			this.emitSlotEvent(APU_EVENT_SLOT_ENDED, info.slot, info.sourceAddr);
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
		this.eventSequence = 0;
		this.fault.resetStatus();
		this.clearCommandLatch();
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_SLOT, 0);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
	}

	public captureState(): AudioControllerState {
		return {
			eventSequence: this.eventSequence,
			apuStatus: this.fault.status,
			apuFaultCode: this.fault.code,
			apuFaultDetail: this.fault.detail,
		};
	}

	public restoreState(state: AudioControllerState): void {
		this.eventSequence = state.eventSequence >>> 0;
		this.fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
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
		this.startPlay(source, slot, this.readResolvedPlayRequest(source));
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

	private startPlay(source: SoundMasterAudioSource, slot: AudioSlot, request: SoundMasterResolvedPlayRequest): void {
		if (!this.soundMaster.isRuntimeAudioReady()) {
			this.fault.raise(APU_FAULT_RUNTIME_UNAVAILABLE, source.sourceAddr);
			return;
		}
		const bytes = new Uint8Array(source.sourceBytes);
		this.memory.readBytesInto(source.sourceAddr, bytes, bytes.byteLength);
		void this.soundMaster.playResolvedSourceOnSlot(slot, source, bytes, request).catch(() => {
			this.fault.raise(APU_FAULT_PLAYBACK_REJECTED, source.sourceAddr);
		});
	}

	private stopSlot(): void {
		const slot = this.readSlot();
		if (slot === undefined) {
			return;
		}
		const fadeSamples = this.memory.readIoU32(IO_APU_FADE_SAMPLES);
		this.soundMaster.stopSlot(slot, fadeSamples > 0 ? apuSamplesToMilliseconds(fadeSamples) : undefined);
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

	private emitSlotEvent(kind: number, slot: AudioSlot, sourceAddr: number): void {
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, kind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, slot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, sourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}

}
