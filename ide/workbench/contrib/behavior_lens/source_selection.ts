import type { BehaviorSourceRowKey } from './model';
import { stateMachineSourceBookmarksEqual, type StateMachineSourceSelection } from './state_machine_selection';
import { mapStateMachineSourceSelection } from './state_machine_selection';
import { copyBehaviorSourceBookmark, mapBehaviorSourceBookmark, type BehaviorSourceBookmark } from './source_bookmark';
import type { ResourceIdentity } from '../../../common/resource';
import type { EditorTextChange } from '../../../editor/text/text_change';

/** Source identity survives geometry replacement; a rendered item is not the owner. */
export type BehaviorSourceSelection = ({ readonly rowKey: BehaviorSourceRowKey } & (
	{ readonly kind: 'node' } | { readonly kind: 'tree-edge' }
)) | StateMachineSourceSelection;

/** One input's semantic intent. Source correspondence rebinds values, never user intent. */
export class BehaviorSourceSelectionState {
	private definitionValue: BehaviorSourceRowKey | null = null;
	private selectedValue: BehaviorSourceSelection | null = null;
	private selectedRevision = 0;
	private definitionRevisionValue = 0;
	private retired = false;
	private bookmark: BehaviorSourceBookmark | undefined;
	public get definitionRowKey(): BehaviorSourceRowKey | null { return this.definitionValue; }
	public get selected(): BehaviorSourceSelection | null { return this.selectedValue; }
	public get selectionRevision(): number { return this.selectedRevision; }
	public get definitionRevision(): number { return this.definitionRevisionValue; }
	public get available(): boolean { return !this.retired; }
	public get pendingBookmark(): BehaviorSourceBookmark | undefined { return this.bookmark; }

	public select(selection: BehaviorSourceSelection | null): void {
		const previous = this.selectedValue;
		if (selection === null) {
			if (previous === null) return;
		} else if (previous !== null && previous.kind === selection.kind && previous.rowKey === selection.rowKey) {
			if (previous.kind === 'node' || previous.kind === 'tree-edge') return;
			if (selection.kind !== 'node' && selection.kind !== 'tree-edge' && stateMachineSourceBookmarksEqual(previous, selection)) return;
		}
		this.selectedValue = selection;
		this.bookmark = undefined;
		this.selectedRevision++;
	}

	public selectDefinition(definition: BehaviorSourceRowKey): void {
		if (this.definitionValue === definition) { this.select({ kind: 'node', rowKey: definition }); return; }
		this.definitionValue = definition;
		this.selectedValue = { kind: 'node', rowKey: definition };
		this.bookmark = undefined;
		this.definitionRevisionValue++;
		this.selectedRevision++;
	}

	/** Explicit history/navigation restoration starts a new selected intent. */
	public restore(definition: BehaviorSourceRowKey | null, selection: BehaviorSourceSelection | null): void {
		if (this.definitionValue !== definition) this.definitionRevisionValue++;
		this.definitionValue = definition;
		this.selectedValue = selection;
		this.bookmark = undefined;
		this.selectedRevision++;
	}

	/** The source producer has proved both occurrences before publishing this pair. */
	public reconcile(definition: BehaviorSourceRowKey | null, selection: BehaviorSourceSelection | null): void {
		const definitionLost = (this.definitionValue === null) !== (definition === null);
		if (definitionLost) this.definitionRevisionValue++;
		if (this.selectedValue?.kind !== selection?.kind || definitionLost) this.selectedRevision++;
		this.definitionValue = definition;
		this.selectedValue = selection;
	}

	/** The originating editor owns continuation; history deliberately starts a new intent. */
	public applySourceBookmark(bookmark: BehaviorSourceBookmark, originIntent: number, history: boolean): void {
		if (!history && this.selectedRevision !== originIntent) return;
		if (history) this.selectedRevision++;
		this.bookmark = copyBehaviorSourceBookmark(bookmark);
	}

	public mapSourceChange(resource: ResourceIdentity, changes: readonly EditorTextChange[]): void {
		if (this.bookmark !== undefined) mapBehaviorSourceBookmark(this.bookmark, resource, changes);
		const selection = this.selectedValue;
		if (selection !== null && (selection.kind === 'state-outcome' || selection.kind === 'state-entry'))
			mapStateMachineSourceSelection(selection, resource, changes);
	}

	public takeSourceBookmark(): BehaviorSourceBookmark | undefined {
		const bookmark = this.bookmark;
		this.bookmark = undefined;
		return bookmark;
	}

	public retire(): void {
		this.retired = true;
		this.bookmark = undefined;
		this.selectedRevision++;
		this.definitionRevisionValue++;
	}
}
