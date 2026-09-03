import { modify } from 'jsonc-parser';

import type { EditorTextModel } from '../../../editor/model/text_model';
import { applyJsoncEditResult } from '../../../editor/model/jsonc_edit';
import { getTextSnapshot } from '../../../editor/text/source_text';
import {
	parseBehaviourTreeDocument,
	type BehaviourTreeDocumentDiagnostic,
	type BehaviourTreeDocumentElementSource,
} from '../../../../toolchain/ts/rompack/behaviour_tree/document';
import type {
	AuthoredBehaviourTreeBlackboardEntry,
	AuthoredBehaviourTreeDecorator,
	AuthoredBehaviourTreeDocument,
	AuthoredBehaviourTreeNode,
	AuthoredBehaviourTreeService,
} from '../../../../toolchain/ts/rompack/behaviour_tree/model';

type BehaviourTreeElementValueByKind = {
	blackboard: AuthoredBehaviourTreeBlackboardEntry;
	node: AuthoredBehaviourTreeNode;
	service: AuthoredBehaviourTreeService;
	decorator: AuthoredBehaviourTreeDecorator;
};

type BehaviourTreeElementKind = keyof BehaviourTreeElementValueByKind;

type BehaviourTreeElementProjectionBase<TKind extends BehaviourTreeElementKind> =
	BehaviourTreeDocumentElementSource & {
		kind: TKind;
		value: BehaviourTreeElementValueByKind[TKind];
	};

export type BehaviourTreeBlackboardProjection = BehaviourTreeElementProjectionBase<
	'blackboard'
>;

export type BehaviourTreeNodeProjection = BehaviourTreeElementProjectionBase<
	'node'
>;

export type BehaviourTreeServiceProjection = BehaviourTreeElementProjectionBase<
	'service'
>;

export type BehaviourTreeDecoratorProjection = BehaviourTreeElementProjectionBase<
	'decorator'
>;

export type BehaviourTreeElementProjection =
	| BehaviourTreeBlackboardProjection
	| BehaviourTreeNodeProjection
	| BehaviourTreeServiceProjection
	| BehaviourTreeDecoratorProjection;

export type BehaviourTreeDocumentProjection = {
	version: number;
	source: string;
	document: AuthoredBehaviourTreeDocument | null;
	diagnostics: readonly BehaviourTreeDocumentDiagnostic[];
	elementsById: ReadonlyMap<string, BehaviourTreeElementProjection>;
	blackboardById: ReadonlyMap<string, BehaviourTreeBlackboardProjection>;
};

type ProjectionChangeListener = (projection: BehaviourTreeDocumentProjection) => void;

function createElementProjection<TKind extends BehaviourTreeElementKind>(
	kind: TKind,
	value: BehaviourTreeElementValueByKind[TKind],
	sources: ReadonlyMap<string, BehaviourTreeDocumentElementSource>,
): BehaviourTreeElementProjectionBase<TKind> {
	return { ...sources.get(value.id)!, kind, value };
}

function appendNodeProjection(
	elements: Map<string, BehaviourTreeElementProjection>,
	sources: ReadonlyMap<string, BehaviourTreeDocumentElementSource>,
	node: AuthoredBehaviourTreeNode,
): void {
	elements.set(node.id, createElementProjection('node', node, sources));
	const services = node.services;
	if (services !== undefined) {
		for (let index = 0; index < services.length; index += 1) {
			const service = services[index];
			elements.set(service.id, createElementProjection('service', service, sources));
		}
	}
	const decorators = node.decorators;
	if (decorators !== undefined) {
		for (let index = 0; index < decorators.length; index += 1) {
			const decorator = decorators[index];
			elements.set(decorator.id, createElementProjection('decorator', decorator, sources));
		}
	}
	switch (node.type) {
		case 'sequence':
		case 'selector':
		case 'random_selector':
			for (let index = 0; index < node.children.length; index += 1) {
				appendNodeProjection(elements, sources, node.children[index]);
			}
			return;
		case 'weighted_random_selector':
			for (let index = 0; index < node.choices.length; index += 1) {
				appendNodeProjection(elements, sources, node.choices[index].child);
			}
			return;
		case 'simple_parallel':
			appendNodeProjection(elements, sources, node.main_task);
			appendNodeProjection(elements, sources, node.background_tree);
			return;
		case 'task':
		case 'timeline':
		case 'wait':
		case 'set_blackboard':
		case 'add_blackboard':
			return;
	}
}

function buildProjection(
	textModel: EditorTextModel<'behaviour_tree'>,
): BehaviourTreeDocumentProjection {
	const source = getTextSnapshot(textModel.buffer);
	const parsed = parseBehaviourTreeDocument(source);
	const elements = new Map<string, BehaviourTreeElementProjection>();
	const blackboard = new Map<string, BehaviourTreeBlackboardProjection>();
	const document = parsed.document;
	if (document !== null) {
		const entries = document.blackboard;
		if (entries !== undefined) {
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				const projection = createElementProjection('blackboard', entry, parsed.elements);
				elements.set(entry.id, projection);
				blackboard.set(entry.id, projection);
			}
		}
		appendNodeProjection(elements, parsed.elements, document.root);
	}
	return {
		version: textModel.version,
		source,
		document,
		diagnostics: parsed.diagnostics,
		elementsById: elements,
		blackboardById: blackboard,
	};
}

/**
 * Retained, versioned projection of one canonical behaviour-tree text model.
 * The projection is rebuilt once per text-model content event; views only read it.
 */
export class BehaviourTreeDocumentModel {
	private projectionValue: BehaviourTreeDocumentProjection;
	private readonly changeListeners = new Set<ProjectionChangeListener>();

	public constructor(public readonly textModel: EditorTextModel<'behaviour_tree'>) {
		this.projectionValue = buildProjection(textModel);
		textModel.onDidChangeContent(() => {
			this.projectionValue = buildProjection(textModel);
			for (const listener of this.changeListeners) {
				listener(this.projectionValue);
			}
		});
	}

	public get projection(): BehaviourTreeDocumentProjection {
		return this.projectionValue;
	}

	public onDidChangeProjection(listener: ProjectionChangeListener): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	public setBlackboardName(elementId: string, name: string): boolean {
		const element = this.projectionValue.blackboardById.get(elementId)!;
		if (element.value.name === name) {
			return false;
		}
		const edits = modify(
			this.projectionValue.source,
			element.path.concat('name'),
			name,
			{},
		);
		applyJsoncEditResult(this.textModel, edits);
		return true;
	}
}

/** Shares one parsed projection between every visual view of a text model. */
export class BehaviourTreeDocumentModelService {
	private readonly models = new WeakMap<
		EditorTextModel<'behaviour_tree'>,
		BehaviourTreeDocumentModel
	>();

	public getOrCreate(textModel: EditorTextModel<'behaviour_tree'>): BehaviourTreeDocumentModel {
		let model = this.models.get(textModel);
		if (model === undefined) {
			model = new BehaviourTreeDocumentModel(textModel);
			this.models.set(textModel, model);
		}
		return model;
	}
}

export const behaviourTreeDocumentModelService = new BehaviourTreeDocumentModelService();
