import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleCapture, readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import { visitRuntimeComponents } from '../behavior_lens/runtime_components';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import type { WorkbenchPropertyElement } from '../../ui/property_tree';
import type { LuaProgramInput } from './editor_input';

export type ProgramInstanceChoice = QuickPickItem & { readonly identity: SuspendedValueIdentity };
type LiveProperty = WorkbenchPropertyElement & { value: string };
type ReceiptRow = { readonly element: LiveProperty; applied: boolean };
const INPUT_FIELDS = ['clock_source', 'source_program', 'program', 'binding_latch', 'last_frame', 'custom_matches', 'queued_command_count', 'queued_event_count'] as const;

function progressionRuntimes(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain): Table | undefined {
	const module = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/progression');
	if (module.kind !== 'value' || module.value === null) return;
	const captured = readRuntimeLuaModuleCapture(sources, guest, domain, 'cartlib/progression', guest.readStringMember(module.value, 'mount'), 'runtime_by_ctx');
	if (captured.kind === 'value') return captured.value as Table;
}

export function readProgramInstances(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, kind: LuaProgramInput['programKind']): ProgramInstanceChoice[] {
	const items: ProgramInstanceChoice[] = [];
	if (kind === 'progression') {
		const runtimes = progressionRuntimes(sources, guest, domain);
		if (runtimes !== undefined) guest.visitTableEntries(runtimes, (ctx, rt) => {
			items.push({ label: guest.formatValue(ctx), description: 'MOUNTED CONTEXT',
				detail: `Revision ${guest.formatValue(guest.readStringMember(guest.readStringMember(rt, 'state'), 'revision'))}`, identity: guest.identity(ctx) });
		});
	} else visitRuntimeComponents(sources, guest, domain, 'cartlib/input/actioneffect/actioneffect_component', component => {
		items.push({ label: guest.formatValue(guest.readStringMember(component, 'id')), description: 'INPUT COMPONENT',
			detail: `Owner ${guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'parent'), 'id'))}`, identity: guest.identity(component) });
	});
	return items;
}

/** No borrowed table survives this read. Program topology is retained until its real identity changes. */
export class LuaProgramRuntimeProjection {
	private readonly stateRows: { readonly slot: number; readonly element: LiveProperty }[] = [];
	private readonly receipts = new Map<ValueTag, Map<number, ReceiptRow[]>>();
	private readonly receiptRows: ReceiptRow[] = [];
	private readonly inputRows: { readonly element: LiveProperty; tag?: ValueTag; scalar?: number }[] = [];
	public constructor(private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession) {}
	public refresh(input: LuaProgramInput, reconcileBookmark = false): void {
		if (!reconcileBookmark && (!input.liveVisible || !input.liveDirty)) return;
		input.liveDirty = false;
		const identity = input.instance;
		if (identity === undefined) { input.status = 'Choose a live instance. Authored programs are not runtime contexts.'; return; }
		let instance: Table | undefined;
		if (input.programKind === 'progression') {
			const runtimes = progressionRuntimes(this.sources, this.guest, input.workingCopy.resource.domain);
			if (runtimes !== undefined) this.guest.visitTableEntries(runtimes, (ctx, rt) => {
				if (this.guest.matchesIdentity(ctx, identity)) instance = rt as Table;
			});
		} else visitRuntimeComponents(this.sources, this.guest, input.workingCopy.resource.domain,
			'cartlib/input/actioneffect/actioneffect_component', component => { if (this.guest.matchesIdentity(component, identity)) instance = component; });
		if (instance === undefined) {
			input.instance = undefined;
			input.live.roots.length = 0;
			rebuildWorkbenchTreeRows(input.live, null);
			input.status = 'Selected instance is no longer mounted.';
			return;
		}
		const guest = this.guest;
		if (input.programKind === 'input') {
			if (input.live.roots.length === 0) {
				this.inputRows.length = 0;
				for (const field of INPUT_FIELDS) this.inputRows.push({ element: this.append(input, field, '') });
				rebuildWorkbenchTreeRows(input.live, null);
				input.live.textDirty = true;
			}
			for (let i = 0; i < INPUT_FIELDS.length; i++) {
				// Immutable programs are identified, not recursively rendered every frame.
				// Latches and queued counts are the changing datapath state.
				const value = guest.readStringMember(instance, INPUT_FIELDS[i]);
				const row = this.inputRows[i], tag = valueTag(value), scalar = guest.identityScalar(value, tag);
				if (row.tag === tag && row.scalar === scalar && (i < 3 || tag !== ValueTag.Table)) continue;
				row.tag = tag; row.scalar = scalar;
				this.setValue(input, row.element, i < 3 ? guest.formatValue(value) : guest.previewValue(value, 2, 32));
			}
			input.status = `LIVE INPUT / ${input.instanceLabel} / compiled program, latch state and queued commands`;
			return;
		}
		const program = guest.readStringMember(instance, 'program') as Table;
		const state = guest.readStringMember(instance, 'state') as Table;
		const revision = guest.readStringMember(state, 'revision') as number;
		const changedProgram = input.programHashId !== program.hashId || input.stateHashId !== state.hashId;
		const changedState = changedProgram || input.stateRevision !== revision;
		if (changedProgram) {
			input.programHashId = program.hashId;
			input.stateHashId = state.hashId;
			input.live.roots.length = 0;
			this.stateRows.length = 0;
			this.receipts.clear(); this.receiptRows.length = 0;
			const keys = guest.readStringMember(guest.readStringMember(state, 'program'), 'key2idx');
			guest.visitTableEntries(keys, (key, slot) => {
				this.stateRows.push({ slot: slot as number, element: this.append(input, guest.formatValue(key), '') });
			});
			guest.visitTableEntries(guest.readStringMember(program, 'rules_by_event'), (event, rules) => {
				guest.visitTableEntries(rules, (_index, rule) => {
					const id = guest.readStringMember(rule, 'id');
					const element = this.append(input, `${guest.formatValue(event)} / ${guest.formatValue(id)}`, '',
						guest.previewValue(rule, 3, 32));
					if (guest.isTruthy(guest.readStringMember(rule, 'apply_once'))) {
						const identity = guest.identity(id);
						let byScalar = this.receipts.get(identity.tag);
						if (byScalar === undefined) { byScalar = new Map(); this.receipts.set(identity.tag, byScalar); }
						let rows = byScalar.get(identity.scalar);
						if (rows === undefined) { rows = []; byScalar.set(identity.scalar, rows); }
						const row = { element, applied: false };
						rows.push(row); this.receiptRows.push(row);
					} else element.value = 'repeatable';
				});
			});
			rebuildWorkbenchTreeRows(input.live, null);
			input.live.textDirty = true;
		}
		const values = guest.readStringMember(state, 'values') as Table;
		if (changedState) for (const row of this.stateRows) this.setValue(input, row.element, guest.formatValue(values.getInteger(row.slot)));
		for (const row of this.receiptRows) row.applied = false;
		guest.visitTableEntries(guest.readStringMember(state, 'apply_done'), (id, value) => {
			const tag = valueTag(id), rows = this.receipts.get(tag)?.get(guest.identityScalar(id, tag));
			if (rows !== undefined) for (const row of rows) row.applied = guest.isTruthy(value);
		});
		for (const row of this.receiptRows) this.setValue(input, row.element, row.applied ? 'apply_once: done' : 'apply_once: pending');
		input.stateRevision = revision;
		if (changedState) input.status = `LIVE PROGRESSION / ${input.instanceLabel} / state revision ${revision} / ${this.stateRows.length} keys`;
	}
	private setValue(input: LuaProgramInput, row: LiveProperty, value: string): void {
		if (row.value === value) return;
		row.value = value;
		input.live.textDirty = true;
	}
	private append(input: LuaProgramInput, label: string, value: string, description = ''): LiveProperty {
		const element: LiveProperty = { kind: 'property', label, value, description, warning: false, displayLabel: '', displayValue: '', displayValueLeft: 0 };
		appendWorkbenchTreeNode(input.live, null, element);
		return element;
	}
}
