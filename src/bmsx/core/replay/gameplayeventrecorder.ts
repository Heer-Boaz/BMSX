import type { Identifier } from '../../rompack/rompack';
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

	private constructor() { }

	public beginFrame(frame: number): void {
		this._frame = frame;
		this._current.length = 0;
	}

	public record(event: GameEvent): void {
		const emitter = event.emitter;
		if (!emitter) {
			throw new Error('[GameplayEventRecorder] Gameplay event missing emitter.');
		}
		this._current.push({ event, emitterId: emitter.id, frame: this._frame });
	}

	public get currentFrame(): ReadonlyArray<RecordedGameplayEvent> {
		return this._current;
	}

	public endFrame(): void {
		// Placeholder for future replay/export integration.
	}
}
