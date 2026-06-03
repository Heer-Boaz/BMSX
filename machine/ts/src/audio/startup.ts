import { consoleCore } from '../core/console';

export function startEngineWithStartupAudio(): void {
	consoleCore.bootstrapStartupAudio();
	consoleCore.start();
}
