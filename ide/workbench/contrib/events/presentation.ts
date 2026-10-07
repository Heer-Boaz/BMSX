import type { HistoricalEvent, EventHistoryStatus, RuntimeEventHistory } from '../../../runtime/event_history';
import { formatValueSnapshot, type ValueSnapshot } from '../../../runtime/value_snapshot';
import type { InspectedProperty } from '../../ui/property_inspector/model';

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

/** Full wrapped snapshot properties use the existing inspector, including complex payloads. */
export function eventProperties(event: HistoricalEvent): InspectedProperty[] {
	const properties: InspectedProperty[] = [{ label: 'Emission',
		value: `#${event.sequence} | timeline ${event.timeline} | slot ${event.domain} | tick ${event.completedTick} | cycle ${event.cycles}`,
		description: 'Tick is the last completed tick at emission. Go to Frame reviews the boundary at or before emission; values were captured before listener dispatch.', warning: false }];
	appendSnapshot(properties, 'Event', event.event);
	appendSnapshot(properties, 'Emitter', event.emitter);
	appendSnapshot(properties, 'Payload', event.payload);
	return properties;
}

function appendSnapshot(properties: InspectedProperty[], path: string, value: ValueSnapshot): void {
	const omitted = (value.kind === 'string' || value.kind === 'table') && value.omitted;
	properties.push({ label: path, value: formatValueSnapshot(value) + (value.kind === 'table' ? ` (${value.entries.length} stored entries)` : ''),
		description: omitted ? 'Snapshot budget reached; contents may be incomplete.' : '', warning: omitted });
	if (value.kind !== 'table') return;
	for (const entry of value.entries) {
		const omittedKey = (entry.key.kind === 'string' || entry.key.kind === 'table') && entry.key.omitted;
		const key = formatValueSnapshot(entry.key) + (omittedKey ? ' [truncated key]' : '');
		appendSnapshot(properties, `${path}[${key}]`, entry.value);
	}
}

export function eventClipboardText(event: HistoricalEvent): string {
	return eventProperties(event).map(property => `${property.label}: ${property.value}${property.warning ? ' [truncated]' : ''}`).join('\n');
}
