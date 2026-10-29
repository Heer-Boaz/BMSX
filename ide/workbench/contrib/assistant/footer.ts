import { truncateMeasuredText, writeWrappedMeasuredLine, type TextRangeMeasure } from '../../../common/text';
import type { AssistantConversation } from '../../services/assistant/conversation';

/** Text deltas do not change context; retain the footer's measured rows independently. */
export class AssistantFooter {
	public readonly lines: string[] = [];
	public statusText = '';
	private contextRevision = 0;
	private renderedRevision = -1;
	private prefix = '';
	private details = '';
	private name = '';
	private width = -1;
	private font: object | undefined;
	private readonly context: { configuration: AssistantConversation['configuration']; usage: AssistantConversation['usage'];
		state: AssistantConversation['state'] | undefined; refreshing: boolean; available: boolean; title: string | undefined; queued: number; queuePaused: boolean } = {
		configuration: undefined, usage: undefined, state: undefined, refreshing: false, available: false, title: undefined, queued: 0, queuePaused: false,
	};
	public updateStatus(model: AssistantConversation): void {
		const last = this.context, title = model.thread?.title;
		if (this.contextRevision !== 0 && last.configuration === model.configuration && last.usage === model.usage
			&& last.state === model.state && last.refreshing === model.accountRefreshing && last.available === model.available
			&& last.title === title && last.queued === model.queued.length && last.queuePaused === model.queuePaused) return;
		last.configuration = model.configuration; last.usage = model.usage; last.state = model.state;
		last.refreshing = model.accountRefreshing; last.available = model.available; last.title = title;
		last.queued = model.queued.length; last.queuePaused = model.queuePaused;
		const state = !model.available ? 'unavailable' : model.accountRefreshing ? 'refreshing account' : model.state;
		const configuration = model.configuration, tier = configuration?.serviceTier, quota = model.usage?.weeklyRemaining;
		const fast = tier === 'fast' || tier === 'priority' ? ' | fast' : tier && tier !== 'default' ? ` | ${tier}` : '';
		const weekly = quota == null ? 'weekly quota unavailable' : `week ${quota}% left`;
		this.details = configuration === undefined ? 'settings not loaded'
			: `${configuration.agent ?? 'Codex'} ${configuration.model ?? 'model unavailable'} | ${configuration.effort ?? 'effort default'}${fast} | ${weekly}`;
		const queue = model.queued.length ? ` | ${model.queued.length} queued${model.queuePaused ? ' (paused)' : ''}` : '';
		this.name = model.thread === undefined ? 'New conversation' : model.thread.title || 'Untitled conversation';
		this.prefix = `${state}${queue}`;
		this.statusText = `${this.prefix} | ${this.name} | ${this.details}`;
		this.contextRevision++;
	}
	public update(model: AssistantConversation, width: number, measure: TextRangeMeasure, font: object): void {
		this.updateStatus(model);
		if (width === this.width && font === this.font && this.contextRevision === this.renderedRevision) return;
		this.width = width; this.font = font; this.renderedRevision = this.contextRevision;
		this.lines.length = 0;
		const fixed = `${this.prefix} | ${this.details} | `;
		const room = width - measure(fixed, 0, fixed.length), minimumTitle = this.name.slice(0, 12);
		if (room >= measure(minimumTitle, 0, minimumTitle.length))
			this.lines.push(`${this.prefix} | ${truncateMeasuredText(this.name, room, measure)} | ${this.details}`);
		else {
			this.lines.push(truncateMeasuredText(`${this.prefix} | ${this.name}`, width, measure));
			writeWrappedMeasuredLine(this.lines, this.details, width, measure);
		}
	}
}
