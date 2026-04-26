import { engineCore } from '../core/engine';

export function startEngineWithStartupAudio(): void {
	engineCore.bootstrapStartupAudio();
	engineCore.start();
}
