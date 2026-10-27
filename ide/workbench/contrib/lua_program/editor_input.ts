import { resourceIdentityKey, type ResourceDomain } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { CompositeTextEditorInput } from '../../common/composite_text_editor_input';
import { createWorkbenchPropertyTree } from '../../ui/property_tree';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { WorkbenchMenuItem } from '../../ui/menu/registry';
import type { LuaProgramKind, LuaProgramOccurrence, LuaProgramProperty } from './source';
import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { Blua32SourceImage } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { WorkbenchPropertyElement } from '../../ui/property_tree';
import { InputInteraction } from '../../../input/interaction';
import type { RuntimeTransport } from '../../../runtime/transport';

let nextInputId = 0;

export class LuaProgramInput extends CompositeTextEditorInput<`program:${string}`, 'lua_program'> {
	public readonly tree = createWorkbenchPropertyTree<LuaProgramProperty>();
	public readonly live = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	public readonly sourceModels = new Map<string, EditorTextModel>();
	private readonly projectionListeners = new Set<() => void>();
	public sourceRevision: symbol | undefined;
	public occurrence: LuaProgramOccurrence | undefined;
	public readonly occurrenceRange: TrackedTextRange;
	public readonly interaction = new InputInteraction();
	private liveVisibleValue = false;
	public liveDirty = true;
	public instance: SuspendedValueIdentity | undefined;
	public runtimeDomain: ResourceDomain | undefined;
	public runtimeImage: Blua32SourceImage | undefined;
	public instanceLabel = '';
	public programHashId = 0;
	public stateHashId = 0;
	public stateRevision = -1;
	public status = '';
	public readonly secondaryActions: WorkbenchMenuItem[] = [];
	public readonly actionBar = createWorkbenchActionBar('luaProgram.title', true, this.secondaryActions);
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, };
	public constructor(public readonly workingCopy: EditorTextModel, public readonly programKind: LuaProgramKind, span: TrackedTextRange, guest: SuspendedGuestSession) {
		super(`program:${nextInputId++}`, 'lua_program', programKind === 'progression' ? 'PROGRESSION' : 'INPUT BINDINGS', true);
		this.occurrenceRange = { ...span };
		this.sourceModels.set(resourceIdentityKey(workingCopy.resource), workingCopy);
		this.setWorkingCopies(new Set(this.sourceModels.values()));
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
		this.disposables.add({ dispose: editorTextModelService.onDidChangeContent((model, event) => {
			if (this.sourceModels.get(resourceIdentityKey(model.resource)) === model) this.invalidateProjection();
			if (this.workingCopy === model) mapTrackedTextRange(this.occurrenceRange, event.changes);
		}) });
		this.disposables.add({ dispose: guest.onDidInvalidate(reason => {
			this.liveDirty = true;
			if (reason !== 'execution') {
				this.interaction.running = false;
				if (reason === 'heap-replaced') this.instance = undefined;
				this.programHashId = 0; this.stateHashId = 0; this.stateRevision = -1;
				this.live.roots.length = 0; this.live.rows.length = 0;
				this.live.selectionIndex = -1; this.live.descriptionElement = undefined; this.live.textDirty = true;
			}
		}) });
	}
	public get liveVisible(): boolean { return this.liveVisibleValue; }
	public inspectRuntime(transport: RuntimeTransport): void {
		this.liveVisibleValue = true;
		this.liveDirty = true;
		this.interaction.setRuntime(transport);
	}
	public showAuthoring(): void {
		this.liveVisibleValue = false;
		this.interaction.setRuntime(null);
	}
	public invalidateProjection(): void { for (const listener of this.projectionListeners) listener(); }
	public onDidInvalidateProjection(listener: () => void): () => void { this.projectionListeners.add(listener); return () => this.projectionListeners.delete(listener); }
	public override dispose(): void { this.interaction.setRuntime(null); this.invalidateProjection(); this.projectionListeners.clear(); super.dispose(); }
	public publishModels(): void { this.setWorkingCopies(new Set(this.sourceModels.values())); }
}
