import { runtimeLuaFunctionSource, RuntimeLuaFunctionSourceCache, type RuntimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedGuestValue, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { BehaviorInspectionProperty } from './inspection';
import { SuspendedValuePresentation } from '../../../runtime/value_presentation';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';

/** Loaded values have no inferred authoring target. Only a mapped closure supplies Source. */
export function inspectBehaviorRuntimeValue(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, label: string, value: SuspendedGuestValue, description: string,
): BehaviorInspectionProperty {
	const source = runtimeLuaFunctionSource(sources, guest, value);
	return { label, value: source === undefined ? guest.formatStoredEntries(value)
		: `CALL TARGET / ${source.resource.domain === -1 ? 'SYSTEM' : `CART ${source.resource.domain}`}\n${source.resource.path}:${source.range.start.line}:${source.range.start.column}`,
		description, warning: false, source };
}

/** Semantic field identity is separate from presentation and from the current guest value. */
export type RuntimePropertyIdentity = { readonly section: string; readonly field: string; readonly key?: SuspendedValueIdentity };
export type RuntimeInspectionProperty = BehaviorInspectionProperty & { readonly identity?: RuntimePropertyIdentity };
export type RuntimePropertyEntryPresentation = { readonly label?: string; readonly prefix?: string; readonly suffix?: string; readonly description?: string };
export type RuntimePropertyFilter = (section: string, field: string, key: SuspendedGuestValue | undefined) => boolean;

export function runtimePropertyIdentitiesEqual(left: RuntimePropertyIdentity, right: RuntimePropertyIdentity): boolean {
	return left.section === right.section && left.field === right.field
		&& (left.key === undefined ? right.key === undefined : right.key !== undefined
			&& left.key.tag === right.key.tag && left.key.scalar === right.key.scalar);
}

export function runtimeInspectionPropertiesEqual(left: RuntimeInspectionProperty, right: RuntimeInspectionProperty): boolean {
	return left.identity === undefined ? right.identity === undefined && left.label === right.label
		: right.identity !== undefined && runtimePropertyIdentitiesEqual(left.identity, right.identity);
}

type PropertyIndexField<T> = { value?: T; readonly keys: Map<ValueTag, Map<number, T>> };

/** Typed semantic lookup shared by pin admission and projector filtering. */
export class RuntimePropertyIndex<T> {
	private readonly sections = new Map<string, Map<string, PropertyIndexField<T>>>();

	public get(identity: RuntimePropertyIdentity): T | undefined {
		const field = this.sections.get(identity.section)?.get(identity.field);
		return identity.key === undefined ? field?.value : field?.keys.get(identity.key.tag)?.get(identity.key.scalar);
	}
	public find(section: string, name: string, key: SuspendedGuestValue | undefined, guest: SuspendedGuestSession): T | undefined {
		const field = this.sections.get(section)?.get(name);
		if (key === undefined) return field?.value;
		const tag = valueTag(key);
		return field?.keys.get(tag)?.get(guest.identityScalar(key, tag));
	}
	public set(identity: RuntimePropertyIdentity, value: T): void {
		let section = this.sections.get(identity.section);
		if (section === undefined) { section = new Map(); this.sections.set(identity.section, section); }
		let field = section.get(identity.field);
		if (field === undefined) { field = { keys: new Map() }; section.set(identity.field, field); }
		if (identity.key === undefined) field.value = value;
		else {
			let keys = field.keys.get(identity.key.tag);
			if (keys === undefined) { keys = new Map(); field.keys.set(identity.key.tag, keys); }
			keys.set(identity.key.scalar, value);
		}
	}
	public delete(identity: RuntimePropertyIdentity): boolean {
		const section = this.sections.get(identity.section), field = section?.get(identity.field);
		if (field === undefined) return false;
		let deleted: boolean;
		if (identity.key === undefined) { deleted = field.value !== undefined; field.value = undefined; }
		else {
			const keys = field.keys.get(identity.key.tag);
			deleted = keys?.delete(identity.key.scalar) === true;
			if (keys?.size === 0) field.keys.delete(identity.key.tag);
		}
		if (field.value === undefined && field.keys.size === 0) section!.delete(identity.field);
		if (section!.size === 0) this.sections.delete(identity.section);
		return deleted;
	}
}

type Property = { label: string; value: string; description: string; warning: boolean; valueChanged: boolean; source?: RuntimeLuaFunctionSource; readonly identity?: RuntimePropertyIdentity };
type PropertyRow = {
	readonly element: Property;
	initialized: boolean;
	labelKey?: SuspendedValueIdentity;
	presentation?: RuntimePropertyEntryPresentation;
	value?: SuspendedValuePresentation;
	source?: RuntimeLuaFunctionSourceCache;
	description?: SuspendedValuePresentation;
	descriptionPrefix?: string;
	descriptionText?: string;
};

/** A live property document owns its rows/formatting. Transient picker presentation is not its data model. */
export class BehaviorRuntimeProperties {
	public readonly items: RuntimeInspectionProperty[] = [];
	public changed = false;
	private readonly rows: PropertyRow[] = [];
	private cursor = 0;
	private compareChanges = false;

	public constructor(private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession, private readonly filter?: RuntimePropertyFilter) {}
	/** Compare only an owner's completed observation of the same runtime binding. */
	public begin(compareChanges = false): void { this.cursor = 0; this.changed = false; this.compareChanges = compareChanges; }
	public invalidate(): void {
		for (const row of this.rows) { row.labelKey = undefined; row.value?.invalidate(); row.source?.invalidate(); row.description?.invalidate(); }
	}

	public text(label: string, value: string, description = '', warning = false): void {
		if (this.filter !== undefined) return;
		const row = this.row(label);
		row.descriptionPrefix = undefined;
		this.publish(row, value, description, warning, undefined);
	}

	public field(section: string, field: string, label: string, value: SuspendedGuestValue, description = '', descriptionValue?: SuspendedGuestValue): void {
		if (this.filter !== undefined && !this.filter(section, field, undefined)) return;
		this.value(this.row(label, section, field), value, description, descriptionValue);
	}

	public entry(section: string, key: SuspendedGuestValue, value: SuspendedGuestValue, presentation?: RuntimePropertyEntryPresentation,
		description = '', descriptionValue?: SuspendedGuestValue, labelKey = key): void {
		if (this.filter !== undefined && !this.filter(section, '', key)) return;
		const row = this.row(undefined, section, '', key);
		if (row.presentation !== presentation || row.labelKey === undefined || !this.guest.matchesIdentity(labelKey, row.labelKey)) {
			const label = presentation?.label ?? `${presentation?.prefix ?? ''}${this.guest.formatValue(labelKey)}${presentation?.suffix ?? ''}`;
			if (row.element.label !== label) { row.element.label = label; this.changed = true; }
			row.presentation = presentation;
			row.labelKey = this.guest.matchesIdentity(labelKey, row.element.identity!.key!) ? row.element.identity!.key : this.guest.identity(labelKey);
		}
		this.value(row, value, presentation?.description ?? description, descriptionValue);
	}

	private value(row: PropertyRow, value: SuspendedGuestValue, description: string, descriptionValue: SuspendedGuestValue | undefined): void {
		const source = valueTag(value) === ValueTag.Closure
			? (row.source ??= new RuntimeLuaFunctionSourceCache(this.sources, this.guest)).update(value) : undefined;
		const text = source === undefined ? (row.value ??= new SuspendedValuePresentation(this.guest)).update(value)
			: row.element.source === source ? row.element.value
			: `CALL TARGET / ${source.resource.domain === -1 ? 'SYSTEM' : `CART ${source.resource.domain}`}\n${source.resource.path}:${source.range.start.line}:${source.range.start.column}`;
		if (descriptionValue !== undefined) {
			const preview = (row.description ??= new SuspendedValuePresentation(this.guest, 'preview')).update(descriptionValue);
			if (row.descriptionPrefix !== description || row.descriptionText !== preview) {
				row.descriptionPrefix = description; row.descriptionText = preview;
				description += preview;
			} else description = row.element.description;
		} else row.descriptionPrefix = undefined;
		this.publish(row, text, description, false, source);
	}

	public finish(): RuntimeInspectionProperty[] {
		if (this.items.length !== this.cursor) { this.items.length = this.cursor; this.rows.length = this.cursor; this.changed = true; }
		return this.items;
	}

	private row(label: string | undefined, section?: string, field = '', key?: SuspendedGuestValue): PropertyRow {
		const index = this.cursor++;
		let row = this.rows[index];
		const identity = row?.element.identity;
		if (row === undefined || (section === undefined ? identity !== undefined || row.element.label !== label
			: identity === undefined || identity.section !== section || identity.field !== field
				|| (key === undefined ? identity.key !== undefined : identity.key === undefined || !this.guest.matchesIdentity(key, identity.key)))) {
			row = { initialized: false, element: { label: label === undefined ? '' : label, value: '', description: '', warning: false, valueChanged: false,
				identity: section === undefined ? undefined : { section, field, key: key === undefined ? undefined : this.guest.identity(key) } } };
			this.rows[index] = row; this.items[index] = row.element; this.changed = true;
		}
		if (label !== undefined && row.element.label !== label) { row.element.label = label; this.changed = true; }
		return row;
	}

	private publish(row: PropertyRow, value: string, description: string, warning: boolean, source: RuntimeLuaFunctionSource | undefined): void {
		const element = row.element;
		const valueChanged = this.compareChanges && row.initialized && element.identity !== undefined && !warning && element.value !== value;
		row.initialized = true;
		if (element.value === value && element.description === description && element.warning === warning && element.source === source
			&& element.valueChanged === valueChanged) return;
		element.value = value; element.description = description; element.warning = warning; element.source = source; element.valueChanged = valueChanged;
		this.changed = true;
	}
}
