import { machineManager } from '../core/machine_manager';

export function startEngineWithStartupAudio(): void {
	machineManager.bootstrapStartupAudio();
	machineManager.start();
}
