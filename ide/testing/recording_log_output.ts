import type { LogLevel, LogOutput } from '../../hosts/common/log';

export type RecordedLogMessage = {
	readonly level: LogLevel;
	readonly message: string;
};

export class RecordingLogOutput implements LogOutput {
	public readonly messages: RecordedLogMessage[] = [];

	public constructor(private readonly output: LogOutput) {
	}

	public log(level: LogLevel, message: string): void {
		this.messages.push({ level, message });
		this.output.log(level, message);
	}
}
