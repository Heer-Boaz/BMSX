import type { ActiveVoiceInfo, SoundMaster, SoundMasterResolvedPlayRequest } from '../../../audio/soundmaster';
import type { AudioType } from '../../../rompack/format';
import {
	APU_CHANNEL_MUSIC,
	APU_CHANNEL_SFX,
	APU_CHANNEL_UI,
	APU_CMD_NONE,
	APU_CMD_PLAY,
	APU_CMD_QUEUE_PLAY,
	APU_CMD_STOP_CHANNEL,
	APU_EVENT_NONE,
	APU_EVENT_VOICE_ENDED,
	APU_FILTER_ALLPASS,
	APU_FILTER_BANDPASS,
	APU_FILTER_HIGHPASS,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWPASS,
	APU_FILTER_LOWSHELF,
	APU_FILTER_NONE,
	APU_FILTER_NOTCH,
	APU_FILTER_PEAKING,
	APU_PRIORITY_AUTO,
	IO_APU_CHANNEL,
	IO_APU_CMD,
	IO_APU_CROSSFADE_MS,
	IO_APU_EVENT_CHANNEL,
	IO_APU_EVENT_HANDLE,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_VOICE,
	IO_APU_FADE_MS,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_HANDLE,
	IO_APU_OFFSET_MS,
	IO_APU_PITCH_CENTS,
	IO_APU_PRIORITY,
	IO_APU_RATE_PERMIL,
	IO_APU_START_AT_LOOP,
	IO_APU_START_FRESH,
	IO_APU_STATUS,
	IO_APU_SYNC_LOOP,
	IO_APU_VOLUME_MILLIDB,
	IRQ_APU,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import type { IrqController } from '../irq/controller';

interface QueuedAudioPlay {
	handle: number;
	id: string;
	request: SoundMasterResolvedPlayRequest;
}

const ACTIVE_VOICE_PENDING = -1;

function decodeChannel(channel: number): AudioType {
	if (channel === APU_CHANNEL_MUSIC) {
		return 'music';
	}
	if (channel === APU_CHANNEL_UI) {
		return 'ui';
	}
	return 'sfx';
}

function encodeChannel(type: AudioType): number {
	if (type === 'music') {
		return APU_CHANNEL_MUSIC;
	}
	if (type === 'ui') {
		return APU_CHANNEL_UI;
	}
	return APU_CHANNEL_SFX;
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
	private readonly activeHandleByType: Record<AudioType, number> = { sfx: 0, music: 0, ui: 0 };
	private readonly activeVoiceByType: Record<AudioType, number> = { sfx: 0, music: 0, ui: 0 };
	private readonly playSequenceByType: Record<AudioType, number> = { sfx: 0, music: 0, ui: 0 };
	private readonly queuedByType: Record<AudioType, QueuedAudioPlay[]> = { sfx: [], music: [], ui: [] };
	private readonly queuedFirstByType: Record<AudioType, number> = { sfx: 0, music: 0, ui: 0 };
	private readonly unsubscribeSfx: () => void;
	private readonly unsubscribeMusic: () => void;
	private readonly unsubscribeUi: () => void;

	public constructor(
		private readonly memory: Memory,
		private readonly soundMaster: SoundMaster,
		private readonly irq: IrqController,
	) {
		this.memory.mapIoWrite(IO_APU_CMD, this.onCommandWrite.bind(this));
		this.unsubscribeSfx = this.soundMaster.addEndedListener('sfx', (info) => this.onVoiceEnded('sfx', info));
		this.unsubscribeMusic = this.soundMaster.addEndedListener('music', (info) => this.onVoiceEnded('music', info));
		this.unsubscribeUi = this.soundMaster.addEndedListener('ui', (info) => this.onVoiceEnded('ui', info));
	}

	public dispose(): void {
		this.unsubscribeSfx();
		this.unsubscribeMusic();
		this.unsubscribeUi();
	}

	public reset(): void {
		this.eventSequence = 0;
		this.activeHandleByType.sfx = 0;
		this.activeHandleByType.music = 0;
		this.activeHandleByType.ui = 0;
		this.activeVoiceByType.sfx = 0;
		this.activeVoiceByType.music = 0;
		this.activeVoiceByType.ui = 0;
		this.playSequenceByType.sfx = 0;
		this.playSequenceByType.music = 0;
		this.playSequenceByType.ui = 0;
		this.queuedByType.sfx.length = 0;
		this.queuedByType.music.length = 0;
		this.queuedByType.ui.length = 0;
		this.queuedFirstByType.sfx = 0;
		this.queuedFirstByType.music = 0;
		this.queuedFirstByType.ui = 0;
		this.resetCommandLatch();
		this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
		this.memory.writeValue(IO_APU_STATUS, 0);
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_CHANNEL, APU_CHANNEL_SFX);
		this.memory.writeValue(IO_APU_EVENT_HANDLE, 0);
		this.memory.writeValue(IO_APU_EVENT_VOICE, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
	}

	private resetCommandLatch(): void {
		this.memory.writeValue(IO_APU_HANDLE, 0);
		this.memory.writeValue(IO_APU_CHANNEL, APU_CHANNEL_SFX);
		this.memory.writeValue(IO_APU_PRIORITY, APU_PRIORITY_AUTO);
		this.memory.writeValue(IO_APU_PITCH_CENTS, 0);
		this.memory.writeValue(IO_APU_VOLUME_MILLIDB, 0);
		this.memory.writeValue(IO_APU_OFFSET_MS, 0);
		this.memory.writeValue(IO_APU_RATE_PERMIL, 1000);
		this.memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_NONE);
		this.memory.writeValue(IO_APU_FILTER_FREQ_HZ, 0);
		this.memory.writeValue(IO_APU_FILTER_Q_MILLI, 1000);
		this.memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, 0);
		this.memory.writeValue(IO_APU_FADE_MS, 0);
		this.memory.writeValue(IO_APU_CROSSFADE_MS, 0);
		this.memory.writeValue(IO_APU_SYNC_LOOP, 0);
		this.memory.writeValue(IO_APU_START_AT_LOOP, 0);
		this.memory.writeValue(IO_APU_START_FRESH, 0);
	}

	public onCommandWrite(): void {
		switch (this.memory.readIoU32(IO_APU_CMD)) {
			case APU_CMD_PLAY:
				this.play();
				this.resetCommandLatch();
				this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
				return;
			case APU_CMD_QUEUE_PLAY:
				this.queuePlay();
				this.resetCommandLatch();
				this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
				return;
			case APU_CMD_STOP_CHANNEL:
				this.stopChannel();
				this.resetCommandLatch();
				this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
				return;
		}
	}

	private play(): void {
		const handle = this.memory.readIoU32(IO_APU_HANDLE);
		const entry = this.memory.getAssetEntryByHandle(handle);
		if (entry.type !== 'audio') {
			throw new Error(`[APU] asset handle ${handle} is not audio.`);
		}
		const channel = decodeChannel(this.memory.readIoU32(IO_APU_CHANNEL));
		this.queuedByType[channel].length = 0;
		this.queuedFirstByType[channel] = 0;
		this.startPlay(handle, entry.id, channel, this.readResolvedPlayRequest());
	}

	private queuePlay(): void {
		const handle = this.memory.readIoU32(IO_APU_HANDLE);
		const entry = this.memory.getAssetEntryByHandle(handle);
		if (entry.type !== 'audio') {
			throw new Error(`[APU] asset handle ${handle} is not audio.`);
		}
		const channel = decodeChannel(this.memory.readIoU32(IO_APU_CHANNEL));
		const request = this.readResolvedPlayRequest();
		if (this.activeHandleByType[channel] !== 0) {
			this.queuedByType[channel].push({ handle, id: entry.id, request });
			return;
		}
		this.startPlay(handle, entry.id, channel, request);
	}

	private startPlay(handle: number, id: string, channel: AudioType, request: SoundMasterResolvedPlayRequest): void {
		if (!this.soundMaster.isRuntimeAudioReady()) {
			throw new Error('[APU] SoundMaster runtime audio is not initialized.');
		}
		if (!this.soundMaster.hasAudio(id)) {
			throw new Error(`[APU] audio asset '${id}' is not loaded in SoundMaster.`);
		}
		this.activeHandleByType[channel] = handle;
		this.playSequenceByType[channel] = (this.playSequenceByType[channel] + 1) >>> 0;
		if (channel === 'music') {
			this.activeVoiceByType[channel] = 0;
			this.playMusic(id);
			return;
		}
		this.activeVoiceByType[channel] = ACTIVE_VOICE_PENDING;
		const playSequence = this.playSequenceByType[channel];
		void this.soundMaster.playResolved(id, request).then((voiceId) => {
			if (this.playSequenceByType[channel] !== playSequence) {
				return;
			}
			this.activeVoiceByType[channel] = voiceId || 0;
			if (!voiceId) {
				this.activeHandleByType[channel] = 0;
			}
		});
	}

	private playMusic(id: string): void {
		const fadeMs = this.memory.readIoI32(IO_APU_FADE_MS);
		const crossfadeMs = this.memory.readIoI32(IO_APU_CROSSFADE_MS);
		const request: Parameters<SoundMaster['requestMusicTransition']>[0] = {
			to: id,
			sync: this.memory.readIoU32(IO_APU_SYNC_LOOP) !== 0 ? 'loop' : 'immediate',
			start_at_loop_start: this.memory.readIoU32(IO_APU_START_AT_LOOP) !== 0,
			start_fresh: this.memory.readIoU32(IO_APU_START_FRESH) !== 0,
		};
		if (crossfadeMs > 0) {
			request.crossfade_ms = crossfadeMs;
		} else {
			request.fade_ms = fadeMs;
		}
		this.soundMaster.requestMusicTransition(request);
	}

	private stopChannel(): void {
		const channel = decodeChannel(this.memory.readIoU32(IO_APU_CHANNEL));
		this.activeHandleByType[channel] = 0;
		this.activeVoiceByType[channel] = 0;
		this.playSequenceByType[channel] = (this.playSequenceByType[channel] + 1) >>> 0;
		this.queuedByType[channel].length = 0;
		this.queuedFirstByType[channel] = 0;
		if (channel === 'music') {
			const fadeMs = this.memory.readIoI32(IO_APU_FADE_MS);
			if (fadeMs > 0) {
				this.soundMaster.stopMusic({ fade_ms: fadeMs });
				return;
			}
			this.soundMaster.stopMusic();
			return;
		}
		this.soundMaster.stop(channel, 'all');
	}

	private readResolvedPlayRequest(): SoundMasterResolvedPlayRequest {
		const priority = this.memory.readIoI32(IO_APU_PRIORITY);
		const pitchCents = this.memory.readIoI32(IO_APU_PITCH_CENTS);
		const volumeMilliDb = this.memory.readIoI32(IO_APU_VOLUME_MILLIDB);
		const offsetMs = this.memory.readIoI32(IO_APU_OFFSET_MS);
		const ratePermil = this.memory.readIoI32(IO_APU_RATE_PERMIL);
		const filterKind = this.memory.readIoU32(IO_APU_FILTER_KIND);
		const request: SoundMasterResolvedPlayRequest = {
			pitchCents,
			volumeMilliDb,
			offsetMs,
			ratePermil,
			filter: null,
		};
		if (priority !== APU_PRIORITY_AUTO) {
			request.priority = priority;
		}
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

	private onVoiceEnded(type: AudioType, info: ActiveVoiceInfo): void {
		const handle = this.memory.resolveAssetHandle(info.id);
		const activeVoice = this.activeVoiceByType[type];
		const activeEnded = activeVoice > 0
			? activeVoice === info.voiceId
			: activeVoice === 0 && this.activeHandleByType[type] === handle;
		if (activeEnded) {
			const queue = this.queuedByType[type];
			const first = this.queuedFirstByType[type];
			const queued = first < queue.length ? queue[first] : undefined;
			if (queued) {
				this.queuedFirstByType[type] = first + 1;
				if (this.queuedFirstByType[type] === queue.length) {
					queue.length = 0;
					this.queuedFirstByType[type] = 0;
				}
				this.startPlay(queued.handle, queued.id, type, queued.request);
			} else {
				this.activeHandleByType[type] = 0;
			}
		}
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_VOICE_ENDED);
		this.memory.writeValue(IO_APU_EVENT_CHANNEL, encodeChannel(type));
		this.memory.writeValue(IO_APU_EVENT_HANDLE, handle);
		this.memory.writeValue(IO_APU_EVENT_VOICE, info.voiceId >>> 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}

}
