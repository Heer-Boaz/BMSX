import type { Identifier } from '../../rompack/rompack';
import type { GameplayCommand } from '../../gameplay/gameplay_command_buffer';

export type RecordedGameplayEvent = {
	event: string;
	emitterId: Identifier;
	frame: number;
	payload?: any;
};

export class GameplayEventRecorder {
	public static readonly instance = new GameplayEventRecorder();

	private _frame: number = 0;
	private readonly _current: RecordedGameplayEvent[] = [];
	private readonly _commands: GameplayCommand[] = [];

	private constructor() { }

	public beginFrame(frame: number): void {
		this._frame = frame;
		this._current.length = 0;
		this._commands.length = 0;
	}

	public record(event: string, emitterId: Identifier, payload?: any): void {
		this._current.push({ event, emitterId, frame: this._frame, payload });
	}

	public recordCommands(commands: ReadonlyArray<GameplayCommand>): void {
		for (let i = 0; i < commands.length; i++) {
			const command = commands[i]!;
			this._commands.push({ ...command });
		}
	}

	public get currentFrame(): ReadonlyArray<RecordedGameplayEvent> {
		return this._current;
	}

	public get currentCommands(): ReadonlyArray<GameplayCommand> {
		return this._commands;
	}

	public endFrame(): void {
		// Placeholder for future replay/export integration.
	}
}
