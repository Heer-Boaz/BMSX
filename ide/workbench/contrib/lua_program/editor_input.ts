import type { EditorTextModel } from '../../../editor/model/text_model';
import { CompositeTextEditorInput } from '../../common/composite_text_editor_input';
import { createWorkbenchPropertyTree } from '../../ui/property_tree';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { LuaProgramKind, LuaProgramOccurrence, LuaProgramProperty } from './source';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { WorkbenchPropertyElement } from '../../ui/property_tree';

let nextInputId = 0;

export class LuaProgramInput extends CompositeTextEditorInput<`program:${string}`, 'lua_program'> {
	public readonly tree = createWorkbenchPropertyTree<LuaProgramProperty>();
	public readonly live = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	public readonly sourceModels = new Map<string, EditorTextModel>();
	private readonly projectionListeners = new Set<() => void>();
	public sourceRevision: symbol | undefined;
	public occurrence: LuaProgramOccurrence | undefined;
	public readonly occurrenceRange: TrackedTextRange;
	public running = false;
	public liveVisible = false;
	public liveDirty = true;
	public historyRestorePending = false;
	public instance: SuspendedValueIdentity | undefined;
	public instanceLabel = '';
	public programHashId = 0;
	public stateHashId = 0;
	public stateRevision = -1;
	public status = '';
	public readonly actionBar = createWorkbenchActionBar('luaProgram.title');
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, };
	public constructor(public readonly workingCopy: EditorTextModel, public readonly programKind: LuaProgramKind, span: TrackedTextRange, guest: SuspendedGuestSession) {
		super(`program:${nextInputId++}`, 'lua_program', programKind === 'progression' ? 'PROGRESSION' : 'INPUT BINDINGS', true);
		this.occurrenceRange = { ...span };
		this.sourceModels.set(workingCopy.resource.path, workingCopy);
		this.setWorkingCopies(new Set(this.sourceModels.values()));
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
		this.disposables.add({ dispose: guest.onDidInvalidate(reason => {
			this.liveDirty = true;
			if (reason !== 'execution') {
				this.running = false;
				this.historyRestorePending = reason === 'history-restored';
				if (reason === 'heap-replaced') this.instance = undefined;
				this.programHashId = 0; this.stateHashId = 0; this.stateRevision = -1;
				this.live.roots.length = 0; this.live.rows.length = 0;
				this.live.selectionIndex = -1; this.live.descriptionElement = undefined; this.live.textDirty = true;
			}
		}) });
	}
	public invalidateProjection(): void { for (const listener of this.projectionListeners) listener(); }
	public onDidInvalidateProjection(listener: () => void): () => void { this.projectionListeners.add(listener); return () => this.projectionListeners.delete(listener); }
	public override dispose(): void { this.invalidateProjection(); this.projectionListeners.clear(); super.dispose(); }
	public publishModels(): void { this.setWorkingCopies(new Set(this.sourceModels.values())); }
}
