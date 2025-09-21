import type { Identifier } from '../../rompack/rompack';

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

	private constructor() { }

	public beginFrame(frame: number): void {
		this._frame = frame;
		this._current.length = 0;
	}

	public record(event: string, emitterId: Identifier, payload?: any): void {
		this._current.push({ event, emitterId, frame: this._frame, payload });
	}

	public get currentFrame(): ReadonlyArray<RecordedGameplayEvent> {
		return this._current;
	}

	public endFrame(): void {
		// Placeholder for future replay/export integration.
	}
}
