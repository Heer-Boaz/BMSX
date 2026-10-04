import type { CapturedEvent, EventCaptureStatus, RuntimeEventCapture } from '../../../runtime/event_capture';
import type { ValueSnapshot } from '../../../runtime/value_snapshot';
import type { InspectedProperty } from '../../ui/property_inspector/model';

export const EVENT_CAPTURE_LABEL: Record<EventCaptureStatus, string> = {
	idle: 'Idle', recording: 'Recording', stopped: 'Stopped',
	full: 'Full - clear to record again',
	'runtime-changed': 'Stopped - runtime changed',
	'history-review': 'Resume live history before recording',
	'image-unavailable': 'No installed cartridge',
	'symbols-unavailable': 'Debug symbols required',
	'function-unavailable': 'Cart has no event emitter',
	'ambiguous-function': 'Event emitter binding is ambiguous',
	'arguments-unavailable': 'Event argument locations unavailable',
};

/** Incremental filtered index. Rendering visits only visible entries, never the guest. */
export class EventProjection {
	public readonly rows: CapturedEvent[] = [];
	private generation = -1;
	private scanned = 0;
	private query = '';
	private filter = '';
	public update(capture: RuntimeEventCapture, filter: string): boolean {
		const query = this.filter === filter ? this.query : filter.toLowerCase();
		this.filter = filter;
		let changed = false;
		if (this.generation !== capture.generation || this.query !== query) {
			this.generation = capture.generation; this.query = query;
			this.scanned = 0; this.rows.length = 0; changed = true;
		}
		for (; this.scanned < capture.records.length; this.scanned++) {
			const record = capture.records[this.scanned];
			if (query !== '' && !record.event.display.toLowerCase().includes(query) && !record.emitter.display.toLowerCase().includes(query)) continue;
			this.rows.push(record); changed = true;
		}
		return changed;
	}
}

/** Full wrapped snapshot properties use the existing inspector, including complex payloads. */
export function eventProperties(event: CapturedEvent): InspectedProperty[] {
	const properties: InspectedProperty[] = [{ label: 'Emission',
		value: `#${event.sequence} | capture ${event.capture} | slot ${event.domain} | tick ${event.completedTick} | cycle ${event.cycles}`,
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

export function eventClipboardText(event: CapturedEvent): string {
	return eventProperties(event).map(property => `${property.label}: ${property.value}${property.warning ? ' [truncated]' : ''}`).join('\n');
}
