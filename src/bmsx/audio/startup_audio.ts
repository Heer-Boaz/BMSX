import { $ } from '../core/engine_core';
import type { Runtime } from '../machine/runtime/runtime';

export function startEngineWithDeferredStartupAudioRefresh(runtime: Runtime): void {
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
				runtime.hostFault.publishStartup(runtime, error);
				console.error('Deferred startup audio refresh failed:', error);
			});
		});
	});
}
