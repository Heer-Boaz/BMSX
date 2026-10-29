import { yamlKeyTokenRetainsRange } from '../../../language/yaml/source_reference';
import { EditorEditStateType, type EditorEditSource } from '../../../editor/model/edit_state';
import type { EditorTextModel, EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { mapTextOffset, mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import type { AemProperty } from './editor_input';

export type AemSourceRole = 'root' | 'property' | 'item' | 'event';

/** One authored key or value start, retained independently of YAML syntax nodes and tree rows. */
export type AemSourceIdentity = {
	readonly id: number;
	readonly role: AemSourceRole;
	readonly range: TrackedTextRange;
	property: AemProperty | undefined;
	eventSection: AemSourceIdentity | undefined;
};

/** History owns source coordinates, never a live property, tree or input. */
export type AemPropertyEditSelection = {
	readonly id: number;
	readonly role: AemSourceRole;
	readonly range: TrackedTextRange;
};

export const aemPropertyEditState = new EditorEditStateType<AemPropertyEditSelection>();

/** One input owns explicit intent and correspondence of its actual authored occurrences. */
export class AemSourceSelectionState {
	private readonly identities = new Map<number, AemSourceIdentity>();
	private readonly ranges = new Map<number, TrackedTextRange>();
	private readonly unbindRanges: () => void;
	private readonly unbindChanges: () => void;
	private readonly candidates = new Map<number, AemSourceIdentity[]>();
	private readonly projected = new Set<AemSourceIdentity>();
	private serial = 0;
	private selectedValue: AemSourceIdentity | undefined;
	private eventValue: AemSourceIdentity | undefined;
	private eventName: string | undefined;
	private selectedRevision = 0;
	private eventRevisionValue = 0;
	private pendingHistory: AemPropertyEditSelection | undefined;
	private retired = false;

	public constructor(model: EditorTextModel, private readonly editSource: EditorEditSource) {
		this.unbindRanges = model.onDidApplyChanges(event => {
			const eventKey = this.eventValue?.range, sectionKey = this.eventValue?.eventSection?.range;
			const singleton = event.changes.length > 1 ? [event.changes[0]] : undefined;
			for (const range of this.ranges.values()) {
				if (range !== eventKey && range !== sectionKey) { mapTrackedTextRange(range, event.changes); continue; }
				const start = range.start, end = range.end;
				let tokenChanged = false, boundaryChanged = false;
				for (const change of event.changes) {
					// The installed event belongs to its written name AND events section.
					// Restoring either spelling never revives the old audition authority.
					if (range.start !== range.end) {
						if (change.deletedLength === 0) {
							if (change.offset > range.start && change.offset < range.end) tokenChanged = true;
							else if (change.insertedLength !== 0 && (change.offset === range.start || change.offset === range.end)) boundaryChanged = true;
						} else if (change.offset < range.end && change.offset + change.deletedLength > range.start) tokenChanged = true;
					}
					if (singleton !== undefined) singleton[0] = change;
					mapTrackedTextRange(range, singleton === undefined ? event.changes : singleton);
				}
				if (tokenChanged || boundaryChanged && !yamlKeyTokenRetainsRange(model.buffer, range,
					mapTextOffset(start, event.changes, -1), mapTextOffset(end, event.changes, 1))) this.eventRevisionValue++;
			}
		});
		this.unbindChanges = model.onDidChangeContent(event => this.didChange(event));
	}

	public get selected(): AemSourceIdentity | undefined { return this.selectedValue; }
	public get event(): AemSourceIdentity | undefined { return this.eventValue; }
	public get revision(): number { return this.selectedRevision; }
	public get eventRevision(): number { return this.eventRevisionValue; }
	public get available(): boolean { return !this.retired; }
	public find(role: AemSourceRole, range: TrackedTextRange): AemSourceIdentity | undefined {
		if (range.start === range.end) return;
		for (const identity of this.identities.values()) if (identity.role === role
			&& identity.range.start === range.start && identity.range.end === range.end) return identity;
		return undefined;
	}

	public select(selected: AemSourceIdentity | undefined): void {
		if (this.selectedValue === selected) return;
		this.selectedValue = selected;
		this.pendingHistory = undefined; this.ranges.delete(0);
		this.selectedRevision++;
		this.publishEvent();
	}
	/** Navigation and history restoration are new intent, even when the same source is selected. */
	public restore(selected: AemSourceIdentity | undefined): void {
		this.selectedValue = selected;
		this.pendingHistory = undefined; this.ranges.delete(0);
		this.selectedRevision++;
		this.eventRevisionValue++;
		this.publishEvent();
	}

	public beginProjection(): void {
		this.candidates.clear();
		this.projected.clear();
		for (const identity of this.identities.values()) {
			if (identity.range.start === identity.range.end) continue;
			let entries = this.candidates.get(identity.range.start);
			if (entries === undefined) { entries = []; this.candidates.set(identity.range.start, entries); }
			entries.push(identity);
		}
	}
	public acquire(role: AemSourceRole, start: number, end: number): AemSourceIdentity {
		let identity = this.candidates.get(start)?.find(candidate => candidate.role === role && candidate.range.end === end && !this.projected.has(candidate));
		if (identity === undefined) {
			identity = { id: ++this.serial, role, range: { start, end }, property: undefined, eventSection: undefined };
			this.identities.set(identity.id, identity); this.ranges.set(identity.id, identity.range);
		}
		this.projected.add(identity);
		return identity;
	}
	public publish(): void {
		for (const identity of this.identities.values()) if (!this.projected.has(identity)) {
			identity.property = undefined;
			this.identities.delete(identity.id); this.ranges.delete(identity.id);
		}
		if (this.pendingHistory !== undefined) {
			const history = this.pendingHistory;
			this.pendingHistory = undefined; this.ranges.delete(0);
			this.selectedValue = undefined;
			for (const identity of this.projected) if (identity.role === history.role
				&& identity.range.start === history.range.start && identity.range.end === history.range.end) {
				this.selectedValue = identity; break;
			}
		} else if (this.selectedValue !== undefined && !this.projected.has(this.selectedValue)) {
			this.selectedValue = undefined;
			this.selectedRevision++;
		}
		this.publishEvent();
		this.candidates.clear(); this.projected.clear();
	}

	private publishEvent(): void {
		const property = this.selectedValue?.property, event = property?.event;
		const name = event?.property?.eventName;
		if (event !== this.eventValue || name !== this.eventName) this.eventRevisionValue++;
		this.eventValue = event; this.eventName = name;
	}
	private didChange(event: EditorTextModelContentChangeEvent): void {
		if (event.editSource !== this.editSource || event.editState === null || !event.editState.is(aemPropertyEditState)) return;
		const selected = event.editState.value;
		if (event.kind === 'undo' || event.kind === 'redo') {
			this.selectedRevision++; this.eventRevisionValue++;
			this.pendingHistory = { ...selected, range: { ...selected.range } };
			this.ranges.set(0, this.pendingHistory.range);
		} else {
			// Only the accepting input can continue a completely replaced scalar.
			// A selection chosen by reentrant callbacks is never replaced here.
			const identity = this.identities.get(selected.id);
			if (identity !== undefined) {
				identity.range.start = selected.range.start; identity.range.end = selected.range.end;
			}
		}
	}
	public retire(): void {
		if (this.retired) return;
		this.retired = true; this.selectedRevision++; this.eventRevisionValue++;
	}
	public dispose(): void {
		this.retire();
		this.unbindRanges(); this.unbindChanges();
		for (const identity of this.identities.values()) identity.property = undefined;
		this.identities.clear(); this.ranges.clear(); this.candidates.clear(); this.projected.clear();
	}
}
