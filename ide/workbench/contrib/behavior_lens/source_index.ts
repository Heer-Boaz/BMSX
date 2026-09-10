import type { EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';

/** Shared indices and mapped occurrences of one document generation, not view selection. */
export class BehaviorSourceIndex {
	public readonly ranges = new Map<BehaviorSourceRowKey, TrackedTextRange>();
	public readonly nodes: BehaviorSourceNode[] = [];
	public readonly nodesByRowKey = new Map<BehaviorSourceRowKey, BehaviorSourceNode>();
	public readonly parentByRowKey = new Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>();
	private mappedVersion = 0;

	public constructor(document: BehaviorSourceDocument, buffer: TextBuffer) {
		this.index(document.definitions, null, buffer);
	}

	public acceptChange(event: EditorTextModelContentChangeEvent): void {
		if (this.mappedVersion === event.version) return; // Other views of this generation already consumed this edit.
		for (const span of this.ranges.values()) mapTrackedTextRange(span, event.changes);
		this.mappedVersion = event.version;
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

const indices = new WeakMap<TextBuffer, WeakMap<BehaviorSourceDocument, BehaviorSourceIndex>>();

export function getBehaviorSourceIndex(document: BehaviorSourceDocument, buffer: TextBuffer): BehaviorSourceIndex {
	let generations = indices.get(buffer);
	if (generations === undefined) { generations = new WeakMap(); indices.set(buffer, generations); }
	let index = generations.get(document);
	if (index === undefined) { index = new BehaviorSourceIndex(document, buffer); generations.set(document, index); }
	return index;
}
