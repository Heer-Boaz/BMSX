import type { ObservedConversation } from '../../services/assistant/observed_conversation';
import { truncateMeasuredText, writeWrappedMeasuredLine, type TextRangeMeasure } from '../../../common/text';

/** Streaming text does not remeasure unchanged conversation metadata. */
export class ObservedConversationFooter {
	public readonly lines: string[] = [];
	private width = -1;
	private font: object;
	private activity: string;
	private pending: boolean;
	private title: string | undefined;
	private configuration: ObservedConversation['configuration'];
	public update(model: ObservedConversation, width: number, measure: TextRangeMeasure, font: object): void {
		const title = model.thread?.title, configuration = model.configuration;
		if (width === this.width && font === this.font && model.activity === this.activity && model.pending === this.pending
			&& title === this.title && configuration === this.configuration) return;
		this.width = width; this.font = font; this.activity = model.activity; this.pending = model.pending;
		this.title = title; this.configuration = configuration;
		this.lines.length = 0;
		const details: string[] = [];
		if (configuration) {
			if (configuration.model !== null) details.push(configuration.model);
			if (configuration.effort !== null) details.push(configuration.effort);
			if (configuration.serviceTier !== null) details.push(configuration.serviceTier);
		}
		const prefix = `Read only | ${model.pending ? 'Loading' : model.activity}`;
		const name = title ?? 'Codex CLI conversations';
		const suffix = details.length > 0 ? ` | ${details.join(' | ')}` : '';
		const fixed = `${prefix} | ${suffix}`, minimumTitle = name.slice(0, 12);
		const room = width - measure(fixed, 0, fixed.length);
		if (room >= measure(minimumTitle, 0, minimumTitle.length)) this.lines.push(`${prefix} | ${truncateMeasuredText(name, room, measure)}${suffix}`);
		else {
			this.lines.push(truncateMeasuredText(`${prefix} | ${name}`, width, measure));
			if (details.length > 0) writeWrappedMeasuredLine(this.lines, details.join(' | '), width, measure);
		}
	}
}
