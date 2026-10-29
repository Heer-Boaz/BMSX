import type { ObservedConversation } from '../../services/assistant/observed_conversation';
import { truncateMeasuredText, writeWrappedMeasuredLine, type TextRangeMeasure } from '../../../common/text';

/** Streaming text does not remeasure unchanged conversation metadata. */
export class ObservedConversationFooter {
	public readonly lines: string[] = [];
	public statusText = '';
	private contextRevision = 0;
	private renderedRevision = -1;
	private prefix = '';
	private name = '';
	private suffix = '';
	private details = '';
	private width = -1;
	private font: object;
	private activity: string;
	private pending: boolean;
	private title: string | undefined;
	private configuration: ObservedConversation['configuration'];
	public updateStatus(model: ObservedConversation): void {
		const title = model.thread?.title, configuration = model.configuration;
		if (model.activity === this.activity && model.pending === this.pending && title === this.title && configuration === this.configuration) return;
		this.activity = model.activity; this.pending = model.pending; this.title = title; this.configuration = configuration;
		this.details = '';
		if (configuration) {
			if (configuration.model !== null) this.details = configuration.model;
			if (configuration.effort !== null) this.details += `${this.details === '' ? '' : ' | '}${configuration.effort}`;
			if (configuration.serviceTier !== null) this.details += `${this.details === '' ? '' : ' | '}${configuration.serviceTier}`;
		}
		this.prefix = `Read only | ${model.pending ? 'Loading' : model.activity}`;
		this.name = title ?? 'Codex CLI conversations';
		this.suffix = this.details === '' ? '' : ` | ${this.details}`;
		this.statusText = `${this.prefix} | ${this.name}${this.suffix}`;
		this.contextRevision++;
	}
	public update(model: ObservedConversation, width: number, measure: TextRangeMeasure, font: object): void {
		this.updateStatus(model);
		if (width === this.width && font === this.font && this.renderedRevision === this.contextRevision) return;
		this.width = width; this.font = font; this.renderedRevision = this.contextRevision;
		this.lines.length = 0;
		const fixed = `${this.prefix} | ${this.suffix}`, minimumTitle = this.name.slice(0, 12);
		const room = width - measure(fixed, 0, fixed.length);
		if (room >= measure(minimumTitle, 0, minimumTitle.length)) this.lines.push(`${this.prefix} | ${truncateMeasuredText(this.name, room, measure)}${this.suffix}`);
		else {
			this.lines.push(truncateMeasuredText(`${this.prefix} | ${this.name}`, width, measure));
			if (this.details !== '') writeWrappedMeasuredLine(this.lines, this.details, width, measure);
		}
	}
}
