import { HostPauseReason, type HostExecutionControl } from './execution_control';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from './audio_output';
import type { VibrationInitialization } from './input/contracts';
import { LogLevel, type LogOutput } from './log';
import type { HostRewind } from './rewind';
import { IO_SYS_STATUS, SYS_STATUS_SUPERVISOR_ACTIVE } from '../../machine/ts/spec/bmsx/io';

export class HostFrameSession {
	public currentTimeMs: number;
	public hostFps = 0;
	private hostUfpsScaled: number;

	public constructor(
		ufpsScaled: number,
		currentTimeMs: number,
		public readonly rewind: HostRewind,
		public readonly execution: HostExecutionControl,
	) {
		this.hostUfpsScaled = ufpsScaled;
		this.currentTimeMs = currentTimeMs;
	}

	public async initializeVibration(
		initialization: VibrationInitialization,
		logOutput: LogOutput,
	): Promise<void> {
		this.execution.setPauseReason(HostPauseReason.VibrationInitialization, true);
		try {
			await initialization.initialize();
		} catch (error) {
			logOutput.log(
				LogLevel.Error,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.execution.setPauseReason(HostPauseReason.VibrationInitialization, false);
		}
	}

	public syncMachineOutput(
		runtime: Runtime,
		audioOutput: HostAudioOutput,
	): void {
		const ufpsScaled = runtime.timing.ufpsScaled;
		if (ufpsScaled !== this.hostUfpsScaled) {
			this.hostUfpsScaled = ufpsScaled;
			audioOutput.syncTiming(ufpsScaled);
		}
		audioOutput.muteSystem(
			(runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) !== 0,
		);
	}
}

