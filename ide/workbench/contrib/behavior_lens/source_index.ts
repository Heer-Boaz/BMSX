import { resourceIdentityKey } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextLocation } from '../../../editor/text/text_location';
import { luaSourceRangeToTextLocation } from '../../../language/lua/source_location';
import type { BehaviorSourceDefinition, BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';

/** Shared indices and mapped occurrences of one document generation, not view selection. */
export class BehaviorSourceIndex {
	private static readonly indices = new WeakMap<EditorTextModel, Map<BehaviorSourceDocument, BehaviorSourceIndex>>();
	public readonly ranges = new Map<BehaviorSourceRowKey, TrackedTextLocation>();
	public readonly models: ReadonlyMap<string, EditorTextModel>;
	public readonly nodes: BehaviorSourceNode[] = [];
	public readonly nodesByRowKey = new Map<BehaviorSourceRowKey, BehaviorSourceNode>();
	public readonly definitionsByRowKey = new Map<BehaviorSourceRowKey, BehaviorSourceDefinition>();
	public readonly parentByRowKey = new Map<BehaviorSourceRowKey, BehaviorSourceRowKey | null>();
	private references = 0;
	private readonly subscriptions: (() => void)[] = [];
	private readonly invalidationListeners = new Set<() => void>();
	private current = true;

	private constructor(private readonly document: BehaviorSourceDocument, public readonly model: EditorTextModel,
		public readonly resolveModel: (path: string) => EditorTextModel, models: ReadonlyMap<string, EditorTextModel>) {
		const rangesByModel = new Map<EditorTextModel, Map<BehaviorSourceRowKey, TrackedTextLocation>>();
		for (const owner of models.values()) {
			rangesByModel.set(owner, new Map());
			this.subscriptions.push(owner.onWillChangeContent(() => this.invalidate()));
		}
		this.models = models;
		for (const definition of document.definitions) this.definitionsByRowKey.set(definition.rowKey, definition);
		this.index(document.definitions, null, rangesByModel);
		for (const [owner, ranges] of rangesByModel) this.subscriptions.push(owner.trackRanges(ranges));
	}

	public get isCurrent(): boolean { return this.current; }

	public onDidInvalidate(listener: () => void): () => void {
		this.invalidationListeners.add(listener);
		return () => this.invalidationListeners.delete(listener);
	}

	/** A workspace dependency can change without modifying any of the displayed source ranges. */
	public invalidate(): void {
		if (!this.current) return;
		this.current = false;
		for (const listener of this.invalidationListeners) listener();
		this.invalidationListeners.clear();
	}

	/** One acquisition per retained view, not per lookup or pane attachment. */
	public static acquire(document: BehaviorSourceDocument, model: EditorTextModel, resolveModel: (path: string) => EditorTextModel): BehaviorSourceIndex {
		let generations = this.indices.get(model);
		if (generations === undefined) { generations = new Map(); this.indices.set(model, generations); }
		let index = generations.get(document);
		if (index === undefined || !index.isCurrent) {
			const models = new Map<string, EditorTextModel>(), primary = resourceIdentityKey(model.resource);
			for (const file of document.files) models.set(file.file, file.file === primary ? model : resolveModel(file.file));
			// Model admission can reenter acquisition and publish this generation first.
			const admitted = generations.get(document);
			if (admitted !== undefined && admitted.isCurrent) index = admitted;
			else { index = new BehaviorSourceIndex(document, model, resolveModel, models); generations.set(document, index); }
		}
		index.references += 1;
		return index;
	}

	public release(): void {
		this.references -= 1;
		if (this.references === 0) {
			this.invalidationListeners.clear();
			for (const unsubscribe of this.subscriptions) unsubscribe();
			const generations = BehaviorSourceIndex.indices.get(this.model)!;
			if (generations.get(this.document) === this) generations.delete(this.document);
		}
	}

	private index(nodes: readonly BehaviorSourceNode[], parent: BehaviorSourceRowKey | null,
		rangesByModel: ReadonlyMap<EditorTextModel, Map<BehaviorSourceRowKey, TrackedTextLocation>>): void {
		for (const node of nodes) {
			const range = luaSourceRangeToTextLocation(this.models, node.occurrenceRange);
			this.ranges.set(node.rowKey, range);
			rangesByModel.get(this.models.get(node.occurrenceRange.path)!)!.set(node.rowKey, range);
			this.nodes.push(node);
			this.nodesByRowKey.set(node.rowKey, node);
			this.parentByRowKey.set(node.rowKey, parent);
			this.index(node.children, node.rowKey, rangesByModel);
		}
	}
}
