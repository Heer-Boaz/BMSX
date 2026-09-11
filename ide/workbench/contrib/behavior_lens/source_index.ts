import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';

/** Shared indices and mapped occurrences of one document generation, not view selection. */
export class BehaviorSourceIndex {
	private static readonly indices = new WeakMap<EditorTextModel, Map<BehaviorSourceDocument, BehaviorSourceIndex>>();
	public readonly ranges = new Map<BehaviorSourceRowKey, TrackedTextRange>();
	public readonly nodes: BehaviorSourceNode[] = [];
	public readonly nodesByRowKey = new Map<BehaviorSourceRowKey, BehaviorSourceNode>();
	public readonly parentByRowKey = new Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>();
	private references = 0;
	private readonly releaseRanges: () => void;

	private constructor(private readonly document: BehaviorSourceDocument, public readonly model: EditorTextModel) {
		this.index(document.definitions, null, model.buffer);
		this.releaseRanges = model.trackRanges(this.ranges);
	}

	/** One acquisition per retained view, not per lookup or pane attachment. */
	public static acquire(document: BehaviorSourceDocument, model: EditorTextModel): BehaviorSourceIndex {
		let generations = this.indices.get(model);
		if (generations === undefined) { generations = new Map(); this.indices.set(model, generations); }
		let index = generations.get(document);
		if (index === undefined) { index = new BehaviorSourceIndex(document, model); generations.set(document, index); }
		index.references += 1;
		return index;
	}

	public release(): void {
		this.references -= 1;
		if (this.references === 0) {
			this.releaseRanges();
			BehaviorSourceIndex.indices.get(this.model)!.delete(this.document);
		}
	}

	private index(nodes: readonly BehaviorSourceNode[], parent: BehaviorSourceRowKey | null, buffer: TextBuffer): void {
		for (const node of nodes) {
			this.ranges.set(node.rowKey, luaSourceRangeToTextRange(buffer, node.occurrenceRange));
			this.nodes.push(node);
			this.nodesByRowKey.set(node.rowKey, node);
			this.parentByRowKey.set(node.rowKey, parent);
			this.index(node.children, node.rowKey, buffer);
		}
	}
}
