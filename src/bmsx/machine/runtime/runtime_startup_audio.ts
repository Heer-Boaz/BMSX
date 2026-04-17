import { $ } from '../../core/engine_core';

export interface StartupAudioFaultSink {
	publishStartupHostFault(error: unknown): void;
}

export function startEngineWithDeferredStartupAudioRefresh(runtime: StartupAudioFaultSink): void {
	$.bootstrapStartupAudio();
	$.start();
	if (!$.platform.audio.available) {
		return;
	}
	const firstFrameHandle = $.platform.frames.start(() => {
		firstFrameHandle.stop();
		const audioRefreshHandle = $.platform.frames.start(() => {
			audioRefreshHandle.stop();
			void $.refresh_audio_assets().catch((error: unknown) => {
				runtime.publishStartupHostFault(error);
				console.error('Deferred startup audio refresh failed:', error);
			});
		});
	});
}
