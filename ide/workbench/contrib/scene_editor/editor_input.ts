import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceIdentityKey } from '../../../common/resource';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { SceneEditorTabId } from '../../ui/tab/id';
import { sourceTabDescription } from '../../ui/tab/titles';
import { SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDocuments } from './source_documents';
import { SceneEditorViewState } from './view_state';

/** Document identity and retention over a contribution-owned context and presentation. */
export class SceneEditorInput extends WorkingCopyEditorInput<SceneEditorTabId, 'scene_editor'> {
	public readonly createView?: () => SceneEditorInput;
	public readonly view: SceneEditorViewState;
	public override canMove(): boolean { return true; }
	public override getWorkingCopies(): readonly EditorTextModel[] { return this.view.authoring.getWorkingCopies(); }

	public constructor(public readonly workingCopy: EditorTextModel, documents: SceneSourceDocuments,
		createView?: (source: SceneEditorInput) => SceneEditorInput) {
		super(`scene:${resourceIdentityKey(workingCopy.resource)}`, 'scene_editor', 'SCENE EDITOR', true);
		const authoring = this.disposables.add(new SceneAuthoringContext(workingCopy, documents));
		// A newly opened document starts at its first declaration; refreshing a view never chooses a subject.
		const scene = authoring.scenes[0];
		if (scene !== undefined) authoring.select(authoring.document!, workingCopy.version, { kind: 'scene', scene });
		this.view = this.disposables.add(new SceneEditorViewState(authoring));
		if (createView !== undefined) this.createView = () => createView(this);
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
	}
}
