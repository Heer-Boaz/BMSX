import type { EditorTextModel } from '../../../editor/model/text_model';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { BehaviorSourceDocument } from './model';
import { buildBehaviorSourceDocument } from './recognizer';

/** One immutable topology per working-copy generation, shared by its definition inputs. */
export class BehaviorSourceDocuments {
	private readonly generations = new WeakMap<EditorTextModel, { revision: symbol; document: BehaviorSourceDocument }>();

	public constructor(private readonly sources: RuntimeSourceState) {}

	public get(model: EditorTextModel): BehaviorSourceDocument {
		const resource = model.resource;
		const project = getOrCreateSemanticProject(resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const snapshot = project.getSnapshot();
		let generation = this.generations.get(model);
		if (generation !== undefined && generation.revision === snapshot.revision) return generation.document;
		let changed = generation === undefined;
		if (generation !== undefined) for (const file of generation.document.files) {
			if (snapshot.getFileData(file.file)?.revision !== file.revision) { changed = true; break; }
		}
		if (changed) {
			generation = { revision: snapshot.revision, document: buildBehaviorSourceDocument(resource, snapshot.getFileData(resource.path)!) };
			this.generations.set(model, generation);
		} else generation!.revision = snapshot.revision;
		return generation!.document;
	}
}
