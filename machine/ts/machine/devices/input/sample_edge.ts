import type { InputControllerActionTable } from './action_table';
import type { InputControllerEventFifo } from './event_fifo';
import type { InputControllerSampleLatch } from './sample_latch';
import type { InputControllerInputSource } from './contracts';

export class InputControllerSampleEdge {
	public constructor(
		private readonly input: InputControllerInputSource,
		private readonly sampleLatch: InputControllerSampleLatch,
		private readonly actionTable: InputControllerActionTable,
		private readonly eventFifo: InputControllerEventFifo,
	) {}

	public onVblankEdge(currentTimeMs: number, nowCycles: number): void {
		if (!this.sampleLatch.consumeVblankEdge(nowCycles)) {
			return;
		}
		this.input.sampleInputControllerPlayers(currentTimeMs);
		this.actionTable.sampleButtons(this.eventFifo);
	}
}
