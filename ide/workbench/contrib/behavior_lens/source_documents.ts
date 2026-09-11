import type { EditorTextModel } from '../../../editor/model/text_model';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { BehaviorSourceDocument } from './model';
import { buildBehaviorSourceDocument } from './recognizer';

/** One immutable topology per working-copy generation, shared by its definition inputs. */
export class BehaviorSourceDocuments {
	private readonly generations = new WeakMap<EditorTextModel, { analysis: FileSemanticData; document: BehaviorSourceDocument }>();

	public constructor(private readonly sources: RuntimeSourceState) {}

	public get(model: EditorTextModel): BehaviorSourceDocument {
		const resource = model.resource;
		const project = getOrCreateSemanticProject(resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const analysis = project.getFileData(resource.path)!;
		let generation = this.generations.get(model);
		if (generation === undefined || generation.analysis !== analysis) {
			generation = { analysis, document: buildBehaviorSourceDocument(resource, analysis) };
			this.generations.set(model, generation);
		}
		return generation.document;
	}
}
