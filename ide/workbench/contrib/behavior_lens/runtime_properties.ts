import { runtimeLuaFunctionSource, RuntimeLuaFunctionSourceCache, type RuntimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedGuestValue, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { BehaviorInspectionProperty } from './inspection';
import { SuspendedValuePresentation, type SuspendedValueFormat } from '../../../runtime/value_presentation';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';

/** Loaded values have no inferred authoring target. Only a mapped closure supplies Source. */
export function inspectBehaviorRuntimeValue(
	sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, label: string, value: SuspendedGuestValue, description: string,
): BehaviorInspectionProperty {
	const source = runtimeLuaFunctionSource(sources, guest, value);
	return { label, value: source === undefined ? guest.formatStoredEntries(value)
		: `CALL TARGET / ${source.executionDomain === -1 ? 'SYSTEM' : `CART ${source.executionDomain}`}\n${source.resource.path}:${source.range.start.line}:${source.range.start.column}`,
		description, warning: false, source };
}

/** Row identity is separate from presentation, logical watch admission and the current guest value. */
export type RuntimePropertyIdentity = { readonly section: string; readonly field: string; readonly key?: SuspendedValueIdentity; readonly parent?: RuntimePropertyIdentity };
export type RuntimeInspectionProperty = BehaviorInspectionProperty & {
	readonly identity?: RuntimePropertyIdentity;
	/** Only the owning runtime mapping can admit a display occurrence as a logical watch target. */
	readonly watchIdentity?: RuntimePropertyIdentity;
	readonly valueTag?: ValueTag;
	readonly valueRevision?: number;
};
export type RuntimePropertyEntryPresentation = {
	readonly label?: string; readonly prefix?: string; readonly suffix?: string; readonly description?: string; readonly referenceType?: string;
	/** Hidden from the default view, not from an explicit logical watch request. */
	readonly internal?: boolean;
};
export type RuntimePropertyFilter = (section: string, field: string, key: SuspendedGuestValue | undefined) => boolean;

export function runtimePropertyIdentitiesEqual(left: RuntimePropertyIdentity, right: RuntimePropertyIdentity): boolean {
	return left.section === right.section && left.field === right.field
		&& (left.key === undefined ? right.key === undefined : right.key !== undefined
			&& left.key.tag === right.key.tag && left.key.scalar === right.key.scalar)
		&& (left.parent === undefined ? right.parent === undefined : right.parent !== undefined && runtimePropertyIdentitiesEqual(left.parent, right.parent));
}

export function runtimeInspectionPropertiesEqual(left: RuntimeInspectionProperty, right: RuntimeInspectionProperty): boolean {
	return left.identity === undefined ? right.identity === undefined && left.label === right.label
		: right.identity !== undefined && runtimePropertyIdentitiesEqual(left.identity, right.identity);
}

type PropertyIndexField<T> = { value?: T; readonly keys: Map<ValueTag, Map<number, T>> };

/** Typed semantic lookup shared by retained rows, pin admission and projector filtering. */
export class RuntimePropertyIndex<T> {
	private readonly sections = new Map<string, Map<string, PropertyIndexField<T>>>();
	private parents: RuntimePropertyIndex<RuntimePropertyIndex<T>> | undefined;

	public get(identity: RuntimePropertyIdentity): T | undefined {
		const field = this.scope(identity.parent, false)?.sections.get(identity.section)?.get(identity.field);
		return identity.key === undefined ? field?.value : field?.keys.get(identity.key.tag)?.get(identity.key.scalar);
	}
	public find(section: string, name: string, key: SuspendedGuestValue | undefined, guest: SuspendedGuestSession, parent?: RuntimePropertyIdentity): T | undefined {
		const field = this.scope(parent, false)?.sections.get(section)?.get(name);
		if (key === undefined) return field?.value;
		const tag = valueTag(key);
		return field?.keys.get(tag)?.get(guest.identityScalar(key, tag));
	}
	public set(identity: RuntimePropertyIdentity, value: T): void {
		const owner = this.scope(identity.parent, true)!;
		let section = owner.sections.get(identity.section);
		if (section === undefined) { section = new Map(); owner.sections.set(identity.section, section); }
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
		const owner = this.scope(identity.parent, false);
		const section = owner?.sections.get(identity.section), field = section?.get(identity.field);
		if (field === undefined) return false;
		let deleted: boolean;
		if (identity.key === undefined) { deleted = field.value !== undefined; field.value = undefined; }
		else {
			const keys = field.keys.get(identity.key.tag);
			deleted = keys?.delete(identity.key.scalar) === true;
			if (keys?.size === 0) field.keys.delete(identity.key.tag);
		}
		if (field.value === undefined && field.keys.size === 0) section!.delete(identity.field);
		if (section!.size === 0) owner!.sections.delete(identity.section);
		if (identity.parent !== undefined && owner!.empty) this.parents!.delete(identity.parent);
		return deleted;
	}
	private get empty(): boolean { return this.sections.size === 0 && (this.parents === undefined || this.parents.empty); }
	private scope(parent: RuntimePropertyIdentity | undefined, create: boolean): RuntimePropertyIndex<T> | undefined {
		if (parent === undefined) return this;
		let parents = this.parents;
		if (parents === undefined) {
			if (!create) return;
			parents = this.parents = new RuntimePropertyIndex();
		}
		let scope = parents.get(parent);
		if (scope === undefined && create) { scope = new RuntimePropertyIndex(); parents.set(parent, scope); }
		return scope;
	}
}

type Property = {
	label: string; value: string; description: string; warning: boolean; valueChanged: boolean;
	compact: boolean; depth: number; group?: boolean; valueTag?: ValueTag; valueRevision?: number; expansion?: PropertyExpansion;
	source?: RuntimeLuaFunctionSource; readonly identity?: RuntimePropertyIdentity; watchIdentity?: RuntimePropertyIdentity;
};
type PropertyExpansion = { expanded: boolean; setExpanded(expanded: boolean): void };
type PropertyRows = {
	readonly rows: PropertyRow[];
	readonly index: RuntimePropertyIndex<PropertyRow>;
	readonly parent?: PropertyRow;
	readonly depth: number;
	cursor: number;
	visit?: (key: SuspendedGuestValue, value: SuspendedGuestValue) => void;
};
type PropertyRow = {
	readonly element: Property;
	readonly owner: PropertyRows;
	position: number;
	initialized: boolean;
	labelKey?: SuspendedValueIdentity;
	presentation?: RuntimePropertyEntryPresentation;
	value?: SuspendedValuePresentation;
	source?: RuntimeLuaFunctionSourceCache;
	description?: SuspendedValuePresentation;
	descriptionPrefix?: string;
	descriptionText?: string;
	tableId?: number;
	children?: PropertyRows;
};

const INDEX_PRESENTATION: RuntimePropertyEntryPresentation = { prefix: '[', suffix: ']' };

/** A live property document owns display state and requests children only for expanded references. */
export class BehaviorRuntimeProperties {
	public readonly items: RuntimeInspectionProperty[] = [];
	public changed = false;
	private readonly root: PropertyRows = { rows: [], index: new RuntimePropertyIndex(), depth: 0, cursor: 0 };
	private compareChanges = false;
	private preserveChanges = false;
	private pendingExpansion = false;

	public constructor(private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession,
		private readonly filter?: RuntimePropertyFilter, private readonly presentation: SuspendedValueFormat = 'entries') {}
	public get expansionPending(): boolean { return this.pendingExpansion; }
	/** Compare only an owner's completed observation of the same runtime binding. */
	public begin(compareChanges = false, preserveChanges = false): void {
		this.root.cursor = 0; this.changed = false; this.compareChanges = compareChanges; this.preserveChanges = preserveChanges; this.pendingExpansion = false;
	}
	public invalidate(): void { this.invalidateRows(this.root); }
	private invalidateRows(rows: PropertyRows): void {
		for (const row of rows.rows) {
			row.labelKey = undefined; row.value?.invalidate(); row.source?.invalidate(); row.description?.invalidate();
			if (row.children !== undefined) this.invalidateRows(row.children);
		}
	}

	public text(label: string, value: string, description = '', warning = false): void {
		if (this.filter !== undefined) return;
		const row = this.row(this.root, label);
		row.element.compact = false;
		row.descriptionPrefix = undefined;
		this.publish(row, value, description, warning, undefined);
	}

	public field(section: string, field: string, label: string, value: SuspendedGuestValue, description = '', descriptionValue?: SuspendedGuestValue): void {
		if (this.filter !== undefined && !this.filter(section, field, undefined)) return;
		this.value(this.row(this.root, label, section, field), value, description, descriptionValue);
	}

	/** An explicitly inspectable raw scope is not an invented logical watch target. */
	public group(section: string, field: string, label: string, value: SuspendedGuestValue): void {
		if (this.filter !== undefined) return;
		const row = this.row(this.root, label, section, field);
		row.element.group = true;
		row.element.watchIdentity = undefined;
		this.value(row, value, '', undefined);
	}

	public entry(section: string, key: SuspendedGuestValue, value: SuspendedGuestValue, presentation?: RuntimePropertyEntryPresentation,
		description = '', descriptionValue?: SuspendedGuestValue, labelKey = key, watchable = true): void {
		if (this.filter !== undefined) { if (!watchable || !this.filter(section, '', key)) return; }
		else if (presentation?.internal) return;
		this.entryRow(this.root, section, key, value, presentation, description, descriptionValue, labelKey, watchable);
	}

	private entryRow(owner: PropertyRows, section: string, key: SuspendedGuestValue, value: SuspendedGuestValue,
		presentation: RuntimePropertyEntryPresentation | undefined, description: string, descriptionValue: SuspendedGuestValue | undefined,
		labelKey: SuspendedGuestValue, watchable: boolean): void {
		const row = this.row(owner, undefined, section, '', key);
		const watchIdentity = watchable ? row.element.identity : undefined;
		if (row.element.watchIdentity !== watchIdentity) { row.element.watchIdentity = watchIdentity; this.changed = true; }
		if (row.presentation !== presentation || row.labelKey === undefined || !this.guest.matchesIdentity(labelKey, row.labelKey)) {
			let label = presentation?.label;
			if (label === undefined) {
				const tag = valueTag(labelKey), text = this.guest.formatValue(labelKey);
				const keyText = owner.depth !== 0 && (tag === ValueTag.Table || tag === ValueTag.Closure || tag === ValueTag.Thread || tag === ValueTag.BuiltinFunction)
					? `${text} #${this.guest.identityScalar(labelKey, tag)}` : text;
				label = `${presentation?.prefix ?? ''}${keyText}${presentation?.suffix ?? ''}`;
			}
			if (row.element.label !== label) { row.element.label = label; this.changed = true; }
			if (row.presentation?.referenceType !== presentation?.referenceType) row.value = undefined;
			row.presentation = presentation;
			row.labelKey = this.guest.matchesIdentity(labelKey, row.element.identity!.key!) ? row.element.identity!.key : this.guest.identity(labelKey);
		}
		this.value(row, value, presentation?.description ?? description, descriptionValue);
	}

	private value(row: PropertyRow, value: SuspendedGuestValue, description: string, descriptionValue: SuspendedGuestValue | undefined): void {
		const tag = valueTag(value);
		row.element.valueTag = tag;
		const source = tag === ValueTag.Closure
			? (row.source ??= new RuntimeLuaFunctionSourceCache(this.sources, this.guest)).update(value) : undefined;
		const format = row.owner.depth === 0 ? this.presentation : 'summary';
		let text = source === undefined ? (row.value ??= new SuspendedValuePresentation(this.guest, format, row.presentation?.referenceType)).update(value)
			: row.element.source === source ? row.element.value
			: format === 'summary' || format === 'watch' ? `${source.resource.path}:${source.range.start.line}`
			: `CALL TARGET / ${source.executionDomain === -1 ? 'SYSTEM' : `CART ${source.executionDomain}`}\n${source.resource.path}:${source.range.start.line}:${source.range.start.column}`;
		if (format === 'watch' && tag === ValueTag.Table && row.value!.observationChanged)
			row.element.valueRevision = (row.element.valueRevision ?? 0) + 1;
		else if (tag !== ValueTag.Table) row.element.valueRevision = undefined;
		if (format === 'summary' && tag === ValueTag.Table) {
			const tableId = this.guest.identityScalar(value, ValueTag.Table);
			if (row.tableId !== tableId) {
				row.tableId = tableId; row.children = undefined; row.element.expansion = undefined;
			}
			let cycle = false;
			for (let ancestor = row.owner.parent; ancestor !== undefined; ancestor = ancestor.owner.parent)
				if (ancestor.tableId === tableId) { cycle = true; break; }
			if (cycle) text += ' (cycle)';
			else {
				const expansion: PropertyExpansion = row.element.expansion ??= { expanded: false, setExpanded: expanded => {
					if (expansion.expanded === expanded) return;
					expansion.expanded = expanded; this.pendingExpansion = true;
				} };
				if (expansion.expanded) this.readChildren(row, value);
			}
		} else if (row.tableId !== undefined) {
			row.tableId = undefined; row.children = undefined; row.element.expansion = undefined; this.changed = true;
		}
		if (descriptionValue !== undefined) {
			const preview = (row.description ??= new SuspendedValuePresentation(this.guest, 'preview')).update(descriptionValue);
			if (row.descriptionPrefix !== description || row.descriptionText !== preview) {
				row.descriptionPrefix = description; row.descriptionText = preview;
				description += preview;
			} else description = row.element.description;
		} else row.descriptionPrefix = undefined;
		this.publish(row, text, description, false, source);
	}

	private readChildren(row: PropertyRow, value: SuspendedGuestValue): void {
		let children = row.children;
		if (children === undefined) {
			children = row.children = { rows: [], index: new RuntimePropertyIndex(), parent: row, depth: row.owner.depth + 1, cursor: 0 };
			const owner = children;
			children.visit = (key, value) => this.entryRow(owner, 'stored', key, value,
				valueTag(key) === ValueTag.String ? undefined : INDEX_PRESENTATION, '', undefined, key, false);
		}
		children.cursor = 0;
		this.guest.visitTableEntries(value, children.visit!);
		this.retire(children);
	}

	public finish(): RuntimeInspectionProperty[] {
		this.retire(this.root);
		const length = this.emit(this.root, 0);
		if (this.items.length !== length) { this.items.length = length; this.changed = true; }
		return this.items;
	}
	private retire(owner: PropertyRows): void {
		if (owner.rows.length === owner.cursor) return;
		for (let position = owner.cursor; position < owner.rows.length; position++) {
			const identity = owner.rows[position].element.identity;
			if (identity !== undefined) owner.index.delete(identity);
		}
		owner.rows.length = owner.cursor;
		this.changed = true;
	}
	private emit(owner: PropertyRows, index: number): number {
		for (const row of owner.rows) {
			if (this.items[index] !== row.element) { this.items[index] = row.element; this.changed = true; }
			index++;
			if (row.element.expansion?.expanded && row.children !== undefined) index = this.emit(row.children, index);
		}
		return index;
	}

	private row(owner: PropertyRows, label: string | undefined, section?: string, field = '', key?: SuspendedGuestValue): PropertyRow {
		const index = owner.cursor++;
		let row = owner.rows[index];
		const identity = row?.element.identity;
		if (row === undefined || (section === undefined ? identity !== undefined || row.element.label !== label
			: identity === undefined || identity.section !== section || identity.field !== field
				|| (key === undefined ? identity.key !== undefined : identity.key === undefined || !this.guest.matchesIdentity(key, identity.key)))) {
			row = this.reconcileRow(owner, index, label, section, field, key);
		}
		if (label !== undefined && row.element.label !== label) { row.element.label = label; this.changed = true; }
		return row;
	}

	/** Keep structural edits off the warmed positional read path. */
	private reconcileRow(owner: PropertyRows, index: number, label: string | undefined, section: string | undefined, field: string, key: SuspendedGuestValue | undefined): PropertyRow {
		const displaced = owner.rows[index];
		let row = section === undefined ? undefined : owner.index.find(section, field, key, this.guest, owner.parent?.element.identity);
		const position = row === undefined ? owner.rows.length : row.position;
		if (row === undefined) {
			const identity: RuntimePropertyIdentity | undefined = section === undefined ? undefined
				: { section, field, key: key === undefined ? undefined : this.guest.identity(key), parent: owner.parent?.element.identity };
			row = { owner, position: index, initialized: false,
				element: { label: label === undefined ? '' : label, value: '', description: '', warning: false, valueChanged: false,
					compact: this.presentation !== 'entries', depth: owner.depth, identity } };
			row.element.watchIdentity = identity;
			if (identity !== undefined) owner.index.set(identity, row);
		} else row.position = index;
		if (displaced !== undefined) { displaced.position = position; owner.rows[position] = displaced; }
		owner.rows[index] = row; this.changed = true;
		return row;
	}

	private publish(row: PropertyRow, value: string, description: string, warning: boolean, source: RuntimeLuaFunctionSource | undefined): void {
		const element = row.element;
		const valueChanged = this.preserveChanges ? element.valueChanged
			: this.compareChanges && row.initialized && element.identity !== undefined && !warning && element.value !== value;
		row.initialized = true;
		if (element.value === value && element.description === description && element.warning === warning && element.source === source
			&& element.valueChanged === valueChanged) return;
		element.value = value; element.description = description; element.warning = warning; element.source = source; element.valueChanged = valueChanged;
		this.changed = true;
	}
}
