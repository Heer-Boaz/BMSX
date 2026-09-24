import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { BehaviorSourceDocument } from './model';
import { buildBehaviorSourceDocument } from './recognizer';
import { BehaviorRegistrationIndex } from './registration_index';

/** One immutable topology per working-copy generation, shared by its definition inputs. */
export class BehaviorSourceDocuments {
	private readonly generations = new WeakMap<EditorTextModel, { revision: symbol; document: BehaviorSourceDocument }>();
	public readonly registrations: BehaviorRegistrationIndex;

	public constructor(private readonly models: EditorTextModelService, private readonly sources: RuntimeSourceState) {
		this.registrations = new BehaviorRegistrationIndex(models, sources);
	}

	public get(model: EditorTextModel): BehaviorSourceDocument {
		const resource = model.resource;
		const project = getOrCreateSemanticProject(this.models, resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const snapshot = project.getSnapshot();
		let generation = this.generations.get(model);
		if (generation === undefined || generation.revision !== snapshot.revision) {
			generation = { revision: snapshot.revision, document: buildBehaviorSourceDocument(resource, snapshot) };
			this.generations.set(model, generation);
		}
		return generation.document;
	}
}
