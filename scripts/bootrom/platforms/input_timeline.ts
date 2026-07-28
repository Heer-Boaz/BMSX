import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { InputEvt, InputHub, SubscriptionHandle } from 'bmsx/platform';
import {
	HeadlessVideoOutput,
	type HeadlessPresentedFrame,
} from '../../../machine/ts/render/headless/video_output';
import { HeadlessCaptureCoordinator } from './headless_capture';

type TimelineFrameSchedule = {
	frame: number;
	repeatEveryFrames?: number;
};

type TimelineTimeSchedule = {
	timeMs: number;
	repeatEveryMs?: number;
};

type InputTimelineEntry = (TimelineFrameSchedule | TimelineTimeSchedule) & {
	event?: InputEvt;
	capture?: boolean;
	repeat?: number;
	description?: string;
};

interface PendingTimelineInput {
	frame: number;
	event: InputEvt;
}

export class InputTimeline {
	public readonly completion: Promise<void>;

	private readonly pendingInputs: PendingTimelineInput[] = [];
	private readonly frameSubscription: SubscriptionHandle;
	private readonly finish: () => void;
	private completionFrame = 0;

	private constructor(
		host: HeadlessVideoOutput,
		private readonly input: InputHub,
		capture: HeadlessCaptureCoordinator,
		frameIntervalMs: number,
		entries: readonly InputTimelineEntry[],
		source: string,
		logger: (message: string) => void,
	) {
		let finish!: () => void;
		this.completion = new Promise((resolve) => {
			finish = resolve;
		});
		this.finish = finish;

		logger(`[${source}] arming presentation-frame timeline`);
		let lastFrame = -1;
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const repeat = entry.repeat || 0;
			const description = entry.description || `entry#${index}`;
			const event = entry.event;

			for (let repetition = 0; repetition <= repeat; repetition += 1) {
				const frame = 'frame' in entry
					? entry.frame + repetition * (entry.repeatEveryFrames || 0)
					: Math.round(
						(entry.timeMs + repetition * (entry.repeatEveryMs || 0))
						/ frameIntervalMs,
					);
				if (frame > lastFrame) {
					lastFrame = frame;
				}
				if (entry.capture) {
					logger(`[${source}] capture ${description} at frame ${frame}`);
					capture.scheduleFrame({
						frame: frame + 1,
						outputFrame: frame,
						description,
						source,
					});
				}
				if (event) {
					logger(`[${source}] schedule ${description} at frame ${frame}`);
					this.pendingInputs.push({ frame, event });
				}
			}
		}
		this.completionFrame = lastFrame + 1;
		this.frameSubscription = host.addPresentedFrameListener(this.handlePresentedFrame);
	}

	public static async load(
		filePath: string,
		frameIntervalMs: number,
		host: HeadlessVideoOutput,
		input: InputHub,
		capture: HeadlessCaptureCoordinator,
		logger: (message: string) => void,
	): Promise<InputTimeline> {
		const resolvedPath = path.resolve(filePath);
		const entries = JSON.parse(
			await fs.readFile(resolvedPath, 'utf8'),
		) as InputTimelineEntry[];
		return new InputTimeline(
			host,
			input,
			capture,
			frameIntervalMs,
			entries,
			`timeline:${path.basename(resolvedPath)}`,
			logger,
		);
	}

	private readonly handlePresentedFrame = (
		presentedFrame: HeadlessPresentedFrame,
	): void => {
		let writeIndex = 0;
		for (let readIndex = 0; readIndex < this.pendingInputs.length; readIndex += 1) {
			const pending = this.pendingInputs[readIndex];
			if (presentedFrame.frameIndex >= pending.frame) {
				this.input.post(pending.event);
				continue;
			}
			this.pendingInputs[writeIndex] = pending;
			writeIndex += 1;
		}
		this.pendingInputs.length = writeIndex;
		if (presentedFrame.frameIndex >= this.completionFrame) {
			this.frameSubscription.unsubscribe();
			this.finish();
		}
	};
}
