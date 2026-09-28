import { truncateMeasuredText, writeWrappedMeasuredLine, type TextRangeMeasure } from '../../../common/text';
import type { AssistantConversation } from '../../services/assistant/conversation';

/** Text deltas do not change context; retain the footer's measured rows independently. */
export class AssistantFooter {
	public lines: string[] = [];
	private width = -1;
	private font: object | undefined;
	private context: { configuration: AssistantConversation['configuration']; usage: AssistantConversation['usage'];
		state: AssistantConversation['state']; refreshing: boolean; available: boolean; title: string | undefined; queued: number; queuePaused: boolean } | undefined;
	public update(model: AssistantConversation, width: number, measure: TextRangeMeasure, font: object): void {
		const last = this.context, title = model.thread?.title;
		if (last && width === this.width && font === this.font && last.configuration === model.configuration && last.usage === model.usage
			&& last.state === model.state && last.refreshing === model.accountRefreshing && last.available === model.available
			&& last.title === title && last.queued === model.queued.length && last.queuePaused === model.queuePaused) return;
		this.width = width; this.font = font;
		this.context = { configuration: model.configuration, usage: model.usage, state: model.state,
			refreshing: model.accountRefreshing, available: model.available, title, queued: model.queued.length, queuePaused: model.queuePaused };
		this.lines = assistantFooter(model, width, measure);
	}
}

/** Observed session context. Narrow panes gain footer rows rather than silently losing quota/model. */
export function assistantFooter(model: AssistantConversation, width: number, measure: TextRangeMeasure): string[] {
	const state = !model.available ? 'unavailable' : model.accountRefreshing ? 'refreshing account' : model.state;
	const configuration = model.configuration;
	const agent = configuration?.agent ?? 'Codex';
	const selected = configuration?.model ?? 'model unavailable';
	const effort = configuration?.effort ?? 'effort default';
	const tier = configuration?.serviceTier;
	const fast = tier === 'fast' || tier === 'priority' ? ' | fast' : tier && tier !== 'default' ? ` | ${tier}` : '';
	const quota = model.usage?.weeklyRemaining;
	const weekly = quota == null ? 'weekly quota unavailable' : `week ${quota}% left`;
	const queue = model.queued.length ? ` | ${model.queued.length} queued${model.queuePaused ? ' (paused)' : ''}` : '';
	const details = configuration === undefined ? 'settings not loaded' : `${agent} ${selected} | ${effort}${fast} | ${weekly}`;
	const prefix = `${state}${queue}`;
	const title = model.thread === undefined ? 'New conversation' : model.thread.title || 'Untitled conversation';
	const fixed = `${prefix} | ${details} | `;
	const room = width - measure(fixed, 0, fixed.length);
	const minimumTitle = title.slice(0, 12);
	if (room >= measure(minimumTitle, 0, minimumTitle.length)) {
		return [`${prefix} | ${truncateMeasuredText(title, room, measure)} | ${details}`];
	}
	const lines = [truncateMeasuredText(`${prefix} | ${title}`, width, measure)];
	writeWrappedMeasuredLine(lines, details, width, measure);
	return lines;
}
