import type { EditorTextModel } from '../../../editor/model/text_model';
import { stringLiteralValue } from '../../../../toolchain/ts/lua/syntax/literals';
import { readLuaSourceRange } from '../../../language/lua/source_edits';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resourceIdentityKey } from '../../../common/resource';
import { ReadonlyEditorInput, WorkingCopyEditorInput, type AbstractEditorInput } from '../../common/editor_input';
import type { SceneEditorTabId } from '../../ui/tab/id';
import { sourceTabDescription } from '../../ui/tab/titles';
import { SceneAuthoringContext, type SceneAuthoredSubject, type SceneAuthoredSubjectReference } from './authoring_context';
import type { SceneSourceDocuments } from './source_documents';
import { SceneViewState } from './scene_view';
import type { SerializedSceneEditorInput } from './editor_serializer';
import { sceneSourceName } from './source_name';

let nextSceneInput = 0;

/** Document identity and retention over a contribution-owned context and presentation. */
export class SceneEditorInput extends WorkingCopyEditorInput<SceneEditorTabId, 'scene_editor'> {
	public readonly createView?: () => SceneEditorInput;
	public readonly view: SceneViewState;
	private readonly subjectPosition = { row: -1, column: -1 };
	private subjectExpression: string | undefined;
	public override canMove(): boolean { return true; }
	public override getWorkingCopies(): readonly EditorTextModel[] { return this.view.authoring.getWorkingCopies(); }
	public override matches(other: AbstractEditorInput<string, string>): boolean {
		if (other === this) return true;
		if (!(other instanceof SceneEditorInput) || this.workingCopy !== other.workingCopy) return false;
		const left = this.view.authoring.subjectSpan, right = other.view.authoring.subjectSpan;
		if (left === undefined || right === undefined) return left === right;
		return left.start !== left.end && right.start !== right.end && left.start === right.start && left.end === right.end;
	}

	public constructor(public readonly workingCopy: EditorTextModel, documents: SceneSourceDocuments, catalog: WorkspaceSourceCatalog,
		createView?: (source: SceneEditorInput) => SceneEditorInput, subject?: SceneAuthoredSubject,
		reference?: SceneAuthoredSubjectReference) {
		super(subject === undefined && reference === undefined ? `scene:${resourceIdentityKey(workingCopy.resource)}`
			: `scene:${resourceIdentityKey(workingCopy.resource)}\0${++nextSceneInput}`, 'scene_editor', 'SCENE EDITOR', true);
		const authoring = this.disposables.add(new SceneAuthoringContext(workingCopy, documents, subject, reference));
		// A newly opened document starts at its first declaration; refreshing a view never chooses a subject.
		const scene = authoring.scenes[0];
		if (scene !== undefined) authoring.select(authoring.document!, workingCopy.version, { kind: 'scene', scene });
		this.view = this.disposables.add(new SceneViewState(authoring, catalog));
		if (createView !== undefined) this.createView = () => createView(this);
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
		this.disposables.add({ dispose: authoring.onDidChangeDocument(() => this.updateSubjectLabel()) });

		this.updateSubjectLabel();
	}

	private updateSubjectLabel(): void {
		const context = this.view.authoring, scene = context.subject;
		if (scene === undefined) {
			if (context.suspended && context.subjectSpan !== undefined) {
				const resource = this.workingCopy.resource;
				this.workingCopy.buffer.positionAt(context.subjectSpan.start, this.subjectPosition);
				this.subjectExpression = undefined;
				const location = `${resource.contextLabel} (${resource.contextId}):${this.subjectPosition.row + 1}:${this.subjectPosition.column + 1} / ${resource.path}`;
				this.setLabel(sceneSourceName(resource, undefined, this.subjectPosition.row + 1, this.subjectPosition.column + 1), location);
			}
			return;
		}
		const range = context.document!.analysis.chunk.locations.range(scene.id.span), resource = this.workingCopy.resource;
		const literal = stringLiteralValue(scene.id);
		this.subjectExpression = literal === undefined ? readLuaSourceRange(this.workingCopy.buffer, range) : undefined;
		const span = context.subjectSpan!;
		this.workingCopy.buffer.positionAt(span.start, this.subjectPosition);
		const title = sceneSourceName(resource, scene.id, this.subjectPosition.row + 1, this.subjectPosition.column + 1);
		const location = `${resource.contextLabel} (${resource.contextId}):${this.subjectPosition.row + 1}:${this.subjectPosition.column + 1} / ${resource.path}`;
		this.setLabel(title, this.subjectExpression === undefined ? location : `${location}\n${this.subjectExpression}`, location);
	}
}

/** An admitted document whose source no longer exists, retaining its exact saved occurrence. */
export class UnavailableSceneEditorInput extends ReadonlyEditorInput<SceneEditorTabId, 'scene_editor'> {
	public constructor(public readonly snapshot: SerializedSceneEditorInput) {
		super(`scene:unavailable\0${++nextSceneInput}`, 'scene_editor', snapshot.title, true);
		this.setLabel(snapshot.title, snapshot.description, snapshot.shortDescription);
	}
	public get resource() { return this.snapshot.source.resource; }
	public override canMove(): boolean { return true; }
	public createView(): UnavailableSceneEditorInput { return new UnavailableSceneEditorInput(this.snapshot); }
	public override matches(other: AbstractEditorInput<string, string>): boolean {
		if (other === this) return true;
		if (!(other instanceof UnavailableSceneEditorInput)) return false;
		const a = this.snapshot, b = other.snapshot, left = a.subject, right = b.subject;
		if (a.source.resource.contextId !== b.source.resource.contextId || a.source.resource.path !== b.source.resource.path
			|| a.source.fingerprint.hash !== b.source.fingerprint.hash || a.source.fingerprint.length !== b.source.fingerprint.length) return false;
		return left === undefined || right === undefined ? left === right
			: left.range.start === right.range.start && left.range.end === right.range.end;
	}
}
