import { engineCore } from '../core/engine';
import type { Runtime } from '../machine/runtime/runtime';

export function startEngineWithDeferredStartupAudioRefresh(runtime: Runtime): void {
	engineCore.bootstrapStartupAudio();
	engineCore.start();
	if (!engineCore.platform.audio.available) {
		return;
	}
	const firstFrameHandle = engineCore.platform.frames.start(() => {
		firstFrameHandle.stop();
		const audioRefreshHandle = engineCore.platform.frames.start(() => {
			audioRefreshHandle.stop();
			void engineCore.refresh_audio_assets().catch((error: unknown) => {
				runtime.hostFault.publishStartup(runtime, error);
				console.error('Deferred startup audio refresh failed:', error);
			});
		});
	});
}
