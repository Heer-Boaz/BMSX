import type { InputControllerInputSource, InputControllerSampleContext, InputControllerSnapshot } from '../../devices/input/contracts';
import { HistoryMode, type RuntimeHistory } from './history';

/** Interposes only on external input consumption, not on host input polling. */
export class HistoryInputSource implements InputControllerInputSource {
	public constructor(private readonly history: RuntimeHistory, private readonly live: InputControllerInputSource) {}

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot, context: InputControllerSampleContext): void {
		const history = this.history;
		if (history.mode === HistoryMode.Replaying) {
			history.inputJournal.replaySample(snapshot);
			return;
		}
		this.live.sampleInputControllerSnapshot(snapshot, context);
		if (history.mode === HistoryMode.Recording) history.inputJournal.recordSample(snapshot, context);
	}

	public supervisorRequestLineHigh(): boolean {
		const history = this.history;
		if (history.mode === HistoryMode.Replaying) return history.inputJournal.replayLine();
		const high = this.live.supervisorRequestLineHigh();
		if (history.mode === HistoryMode.Recording) history.recordInputBoundary(high);
		return high;
	}

	public applyInputControllerVibrationEffect(padIndex: number, durationMs: number, intensity: number): void {
		if (this.history.mode === HistoryMode.Replaying || this.history.mode === HistoryMode.Reviewing) return;
		this.live.applyInputControllerVibrationEffect(padIndex, durationMs, intensity);
	}
}
