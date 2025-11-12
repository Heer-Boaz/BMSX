import type { Identifier } from '../../rompack/rompack';
import type { GameplayCommandWithMeta } from '../../ecs/gameplay_command_buffer';
import type { GameEvent } from '../game_event';

export type RecordedGameplayEvent = {
	event: GameEvent;
	emitterId: Identifier;
	frame: number;
};

export class GameplayEventRecorder {
	public static readonly instance = new GameplayEventRecorder();

	private _frame: number = 0;
	private readonly _current: RecordedGameplayEvent[] = [];
	private readonly _commands: GameplayCommandWithMeta[] = [];

	private constructor() { }

	public beginFrame(frame: number): void {
		this._frame = frame;
		this._current.length = 0;
		this._commands.length = 0;
	}

	public record(event: GameEvent): void {
		const emitter = event.emitter;
		if (!emitter) {
			throw new Error('[GameplayEventRecorder] Gameplay event missing emitter.');
		}
		this._current.push({ event, emitterId: emitter.id, frame: this._frame });
	}

	public recordCommands(commands: ReadonlyArray<GameplayCommandWithMeta>): void {
		for (let i = 0; i < commands.length; i++) {
			const command = commands[i]!;
			this._commands.push({ ...command });
		}
	}

	public get currentFrame(): ReadonlyArray<RecordedGameplayEvent> {
		return this._current;
	}

	public get currentCommands(): ReadonlyArray<GameplayCommandWithMeta> {
		return this._commands;
	}

	public endFrame(): void {
		// Placeholder for future replay/export integration.
	}
}
