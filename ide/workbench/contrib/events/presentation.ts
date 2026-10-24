import type { HistoricalEvent, EventHistoryStatus, RuntimeEventHistory } from '../../../runtime/event_history';
import { formatValueSnapshot, type ValueSnapshot } from '../../../runtime/value_snapshot';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import type { EditorFont } from '../../../editor/ui/view/font';
import { measureTextRange } from '../../../editor/common/text/layout';
import { truncateMeasuredText, writeWrappedMeasuredLine } from '../../../common/text';
import type { EventViewerInput } from './editor_input';

export const EVENT_HISTORY_LABEL: Record<EventHistoryStatus, string> = {
	live: 'Live', replay: 'History review',
	'symbols-unavailable': 'Debug symbols required',
	'function-unavailable': 'No event emitter in this image',
	'ambiguous-function': 'Ambiguous event emitter',
	'arguments-unavailable': 'Event arguments unavailable',
};

/** Incremental filtered index. Rendering visits only visible entries, never the guest. */
export class EventProjection {
	public readonly rows: HistoricalEvent[] = [];
	public removed = 0;
	public maxTimeline = 0;
	public maxCompletedTick = 0;
	private generation = -1;
	private scanned = 0;
	private query = '';
	private filter = '';
	public update(history: RuntimeEventHistory, filter: string): boolean {
		const query = this.filter === filter ? this.query : filter.toLowerCase();
		this.filter = filter;
		let changed = false;
		this.removed = 0;
		if (this.generation !== history.generation || this.query !== query) {
			this.generation = history.generation;
			this.query = query;
			this.scanned = history.firstSequence;
			this.rows.length = 0;
			this.maxTimeline = 0;
			this.maxCompletedTick = 0;
			changed = true;
		}
		while (this.removed < this.rows.length && this.rows[this.removed].sequence < history.firstSequence) this.removed++;
		if (this.removed > 0) { this.rows.splice(0, this.removed); changed = true; }
		this.scanned = Math.max(this.scanned, history.firstSequence);
		for (; this.scanned < history.endSequence; this.scanned++) {
			const record = history.at(this.scanned);
			if (query !== '' && !formatValueSnapshot(record.event).toLowerCase().includes(query) && !formatValueSnapshot(record.emitter).toLowerCase().includes(query)) continue;
			this.rows.push(record);
			this.maxTimeline = Math.max(this.maxTimeline, record.timeline);
			this.maxCompletedTick = Math.max(this.maxCompletedTick, record.completedTick);
			changed = true;
		}
		return changed;
	}
}

type EventLabel = { timeline: string; tick: string; event: string; fullEvent: string };
export type EventViewerRow = { index: number; top: number; label: EventLabel };

/** Visible prepared rows share cached immutable snapshot labels; paint never formats history. */
export class EventViewerPresentation {
	public readonly rows: EventViewerRow[] = [];
	public readonly emptyLines: string[] = [];
	private readonly labels = new Map<number, EventLabel>();
	private generation = -1;
	private firstSequence = -1;
	private width = -1;
	private font: EditorFont | null = null;
	private offset = 0;
	private height = 0;
	private firstRow = -1;
	private emptyText = '';

	public update(input: EventViewerInput, layoutChanged: boolean, projected: boolean): void {
		const { layout, viewport, history } = input;
		const firstRow = Math.trunc(viewport.scrollTop / layout.rowHeight);
		const labelsChanged = this.generation !== history.generation || this.width !== layout.eventWidth || this.font !== layout.font;
		if (labelsChanged) this.labels.clear();
		if (this.firstSequence !== history.firstSequence) {
			for (const sequence of this.labels.keys()) if (sequence < history.firstSequence) this.labels.delete(sequence);
		}
		if (labelsChanged || projected || layoutChanged || this.offset !== viewport.offsetTop || this.height !== viewport.height || firstRow !== this.firstRow) {
			const records = input.projection.rows;
			let count = 0;
			for (let index = firstRow, top = viewport.offsetTop + index * layout.rowHeight;
				index < records.length && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
				const record = records[index];
				let label = this.labels.get(record.sequence);
				if (label === undefined) {
					const fullEvent = `${formatValueSnapshot(record.event)} / ${formatValueSnapshot(record.emitter)}`;
					label = { timeline: `T${record.timeline}`, tick: String(record.completedTick),
						event: truncateMeasuredText(fullEvent, layout.eventWidth - 4, measureTextRange), fullEvent };
					this.labels.set(record.sequence, label);
				}
				const row = this.rows[count];
				if (row === undefined) this.rows.push({ index, top, label });
				else { row.index = index; row.top = top; row.label = label; }
				count++;
			}
			this.rows.length = count;
		}
		const emptyText = input.filter !== '' ? 'No matching events.\nChange or clear the filter.'
			: history.status === 'live' ? 'No events yet.\nPlay or step the runtime.' : EVENT_HISTORY_LABEL[history.status];
		if (emptyText !== this.emptyText || labelsChanged || layoutChanged) {
			this.emptyLines.length = 0;
			for (const line of emptyText.split('\n')) writeWrappedMeasuredLine(this.emptyLines, line, layout.eventWidth - 4, measureTextRange);
			this.emptyText = emptyText;
		}
		this.generation = history.generation; this.firstSequence = history.firstSequence;
		this.width = layout.eventWidth; this.font = layout.font;
		this.offset = viewport.offsetTop; this.height = viewport.height;
		this.firstRow = firstRow;
	}
	public reset(): void { this.labels.clear(); this.rows.length = 0; this.generation = -1; }
}

/** Captured values lead; provenance help is disclosed without hiding current snapshot warnings. */
export function eventProperties(event: HistoricalEvent): InspectedProperty[] {
	const properties: InspectedProperty[] = [];
	appendSnapshot(properties, 'Event', event.event, false);
	appendSnapshot(properties, 'Emitter', event.emitter, false);
	appendSnapshot(properties, 'Payload', event.payload, false);
	properties.push({ compact: true, descriptionDisplay: 'disclosure', label: 'Emission',
		value: `#${event.sequence} | timeline ${event.timeline} | slot ${event.domain} | tick ${event.completedTick} | cycle ${event.cycles}`,
		description: 'Tick is the last completed tick at emission. Go to Frame reviews the boundary at or before emission; values were captured before listener dispatch.', warning: false });
	return properties;
}

function appendSnapshot(properties: InspectedProperty[], path: string, value: ValueSnapshot, pathOmitted: boolean): void {
	const omitted = (value.kind === 'string' || value.kind === 'table') && value.omitted;
	const description = pathOmitted
		? omitted ? 'Snapshot budget reached; key path and contents may be incomplete.' : 'Snapshot budget reached; key path may be incomplete.'
		: omitted ? 'Snapshot budget reached; contents may be incomplete.' : '';
	properties.push({ compact: true, label: path, value: formatValueSnapshot(value) + (value.kind === 'table' ? ` (${value.entries.length} stored entries)` : ''),
		description, warning: omitted || pathOmitted });
	if (value.kind !== 'table') return;
	for (const entry of value.entries) {
		const omittedKey = (entry.key.kind === 'string' || entry.key.kind === 'table') && entry.key.omitted;
		const key = formatValueSnapshot(entry.key) + (omittedKey ? ' [truncated key]' : '');
		appendSnapshot(properties, `${path}[${key}]`, entry.value, pathOmitted || omittedKey);
	}
}

export function eventClipboardText(event: HistoricalEvent): string {
	return eventProperties(event).map(property => `${property.label}: ${property.value}${property.warning ? ' [truncated]' : ''}`).join('\n');
}
