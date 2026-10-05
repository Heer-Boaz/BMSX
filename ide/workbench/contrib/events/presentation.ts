import type { HistoricalEvent, EventHistoryStatus, RuntimeEventHistory } from '../../../runtime/event_history';
import type { ValueSnapshot } from '../../../runtime/value_snapshot';
import type { InspectedProperty } from '../../ui/property_inspector/model';

export const EVENT_HISTORY_LABEL: Record<EventHistoryStatus, string> = {
	live: 'Live', replay: 'History review', uninstrumented: 'Debug build required for event history',
};

/** Incremental filtered index. Rendering visits only visible entries, never the guest. */
export class EventProjection {
	public readonly rows: HistoricalEvent[] = [];
	public removed = 0;
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
			changed = true;
		}
		while (this.removed < this.rows.length && this.rows[this.removed].sequence < history.firstSequence) this.removed++;
		if (this.removed > 0) { this.rows.splice(0, this.removed); changed = true; }
		this.scanned = Math.max(this.scanned, history.firstSequence);
		for (; this.scanned < history.endSequence; this.scanned++) {
			const record = history.at(this.scanned);
			if (query !== '' && !record.event.display.toLowerCase().includes(query) && !record.emitter.display.toLowerCase().includes(query)) continue;
			this.rows.push(record);
			changed = true;
		}
		return changed;
	}
}

/** Full wrapped snapshot properties use the existing inspector, including complex payloads. */
export function eventProperties(event: HistoricalEvent): InspectedProperty[] {
	const properties: InspectedProperty[] = [{ label: 'Emission',
		value: `#${event.sequence} | timeline ${event.timeline} | slot ${event.domain} | tick ${event.completedTick} | cycle ${event.cycles}`,
		description: 'Tick is the last completed tick at emission. Values are captured before listener dispatch.', warning: false }];
	appendSnapshot(properties, 'Event', event.event);
	appendSnapshot(properties, 'Emitter', event.emitter);
	appendSnapshot(properties, 'Payload', event.payload);
	return properties;
}

function appendSnapshot(properties: InspectedProperty[], path: string, value: ValueSnapshot): void {
	properties.push({ label: path, value: value.display + (value.entries.length > 0 ? ` (${value.entries.length} stored entries)` : ''),
		description: value.omitted ? 'Snapshot budget reached; remaining contents were not captured.' : '', warning: value.omitted });
	for (const entry of value.entries) {
		const key = entry.key.display + (entry.key.omitted ? ' [truncated key]' : '');
		appendSnapshot(properties, `${path}[${key}]`, entry.value);
	}
}

export function eventClipboardText(event: HistoricalEvent): string {
	return eventProperties(event).map(property => `${property.label}: ${property.value}${property.warning ? ' [truncated]' : ''}`).join('\n');
}
