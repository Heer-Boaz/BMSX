import type { Table } from '../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { STORED_ENTRIES_PREVIEW_LIMIT, type SuspendedGuestSession, type SuspendedGuestValue } from './suspended_guest';

type ValuePart = { tag: ValueTag; scalar: number; entries: number };

/** Retains display inputs, never guest references. Mutable tables are reread before reusing text. */
export class SuspendedValuePresentation {
	private readonly parts: ValuePart[] = [];
	private readonly entry = new ValueSlots(2);
	private cursor = 0;
	private rootEntries = 0;
	private changed = false;
	private valid = false;
	private text = '';
	private readonly captureStoredEntry = (key: SuspendedGuestValue, value: SuspendedGuestValue): void => {
		this.setEntryCount(this.capture(key), 0);
		this.capturePreview(value);
		this.rootEntries++;
	};

	public constructor(private readonly guest: SuspendedGuestSession, private readonly format: 'entries' | 'preview' = 'entries') {}

	/** String ids can be reused by restore; even equal raw inputs must be formatted in the new heap. */
	public invalidate(): void { this.valid = false; }

	public update(value: SuspendedGuestValue): string {
		this.cursor = 0;
		this.changed = !this.valid;
		if (this.format === 'entries' && valueTag(value) === ValueTag.Table) {
			const root = this.capture(value);
			this.rootEntries = 0;
			this.guest.visitTableEntries(value, this.captureStoredEntry);
			this.setEntryCount(root, this.rootEntries);
		} else this.capturePreview(value);
		if (this.parts.length !== this.cursor) { this.parts.length = this.cursor; this.changed = true; }
		if (this.changed) this.text = this.format === 'entries'
			? this.guest.formatStoredEntries(value) : this.guest.previewValue(value, 1, STORED_ENTRIES_PREVIEW_LIMIT);
		this.valid = true;
		return this.text;
	}

	private capture(value: SuspendedGuestValue): number {
		const index = this.cursor++, tag = valueTag(value), scalar = this.guest.identityScalar(value, tag);
		const part = this.parts[index];
		if (part === undefined) { this.parts.push({ tag, scalar, entries: 0 }); this.changed = true; }
		else if (part.tag !== tag || !Object.is(part.scalar, scalar)) {
			part.tag = tag; part.scalar = scalar; this.changed = true;
		}
		return index;
	}

	private setEntryCount(index: number, count: number): void {
		const part = this.parts[index];
		if (part.entries !== count) { part.entries = count; this.changed = true; }
	}

	/** Matches previewValue(1, 8): its immediate stored entries, terminal nested tables and ellipsis. */
	private capturePreview(value: SuspendedGuestValue): void {
		const index = this.capture(value);
		if (valueTag(value) !== ValueTag.Table) { this.setEntryCount(index, 0); return; }
		const table = value as Table, entry = this.entry;
		let count = 0, hasEntry = table.next(ValueTag.Nil, NaN, null, entry, 0);
		try {
			while (hasEntry && count < STORED_ENTRIES_PREVIEW_LIMIT) {
				this.setEntryCount(this.capture(entry.get(0)), 0);
				this.setEntryCount(this.capture(entry.get(1)), 0);
				count++;
				hasEntry = table.next(entry.getTag(0), entry.getScalar(0), entry.getReference(0), entry, 0);
			}
			this.setEntryCount(index, hasEntry ? count + 1 : count);
		} finally { entry.clear(2); }
	}
}
