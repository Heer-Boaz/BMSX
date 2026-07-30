export const enum LogLevel {
	Debug,
	Info,
	Warn,
	Error,
}

export interface LogOutput {
	log(level: LogLevel, message: string): void;
}

export class ConsoleLogOutput implements LogOutput {
	public log(level: LogLevel, message: string): void {
		switch (level) {
			case LogLevel.Debug:
				console.debug(message);
				return;
			case LogLevel.Info:
				console.info(message);
				return;
			case LogLevel.Warn:
				console.warn(message);
				return;
			case LogLevel.Error:
				console.error(message);
				return;
		}
	}
}
