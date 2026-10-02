import { runtimeLuaFunctionSource, RuntimeLuaFunctionSourceCache, type RuntimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedGuestValue } from '../../../runtime/suspended_guest';
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

type Property = { label: string; value: string; description: string; warning: boolean; source?: RuntimeLuaFunctionSource };
type PropertyRow = {
	readonly element: Property;
	value?: SuspendedValuePresentation;
	source?: RuntimeLuaFunctionSourceCache;
	description?: SuspendedValuePresentation;
	descriptionPrefix?: string;
	descriptionText?: string;
};

/** A live property document owns its rows/formatting. Transient picker presentation is not its data model. */
export class BehaviorRuntimeProperties {
	public readonly items: BehaviorInspectionProperty[] = [];
	public changed = false;
	private readonly rows: PropertyRow[] = [];
	private cursor = 0;

	public constructor(private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession) {}
	public begin(): void { this.cursor = 0; this.changed = false; }
	public invalidate(): void {
		for (const row of this.rows) { row.value?.invalidate(); row.source?.invalidate(); row.description?.invalidate(); }
	}

	public text(label: string, value: string, description = '', warning = false): void {
		const row = this.row(label);
		row.descriptionPrefix = undefined;
		this.publish(row.element, value, description, warning, undefined);
	}

	public value(label: string, value: SuspendedGuestValue, description = '', descriptionValue?: SuspendedGuestValue): void {
		const row = this.row(label);
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
		this.publish(row.element, text, description, false, source);
	}

	public finish(): BehaviorInspectionProperty[] {
		if (this.items.length !== this.cursor) { this.items.length = this.cursor; this.rows.length = this.cursor; this.changed = true; }
		return this.items;
	}

	private row(label: string): PropertyRow {
		const index = this.cursor++;
		let row = this.rows[index];
		if (row === undefined || row.element.label !== label) {
			row = { element: { label, value: '', description: '', warning: false } };
			this.rows[index] = row; this.items[index] = row.element; this.changed = true;
		}
		return row;
	}

	private publish(row: Property, value: string, description: string, warning: boolean, source: RuntimeLuaFunctionSource | undefined): void {
		if (row.value === value && row.description === description && row.warning === warning && row.source === source) return;
		row.value = value; row.description = description; row.warning = warning; row.source = source;
		this.changed = true;
	}
}
