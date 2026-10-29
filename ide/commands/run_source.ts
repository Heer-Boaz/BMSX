import type { EditorTextModel } from '../editor/model/text_model';
import { editorTextModelService } from '../editor/model/model_service';
import type { ResourceIdentity } from '../common/resource';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../common/resource';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState, Blua32SourceImage } from '../runtime/sources';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { BootService } from '../workbench/services/execution/boot';
import type { RunTargetSelection } from '../workbench/services/execution/run_target';
import type { QuickInputController, QuickInputOptions } from '../workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../workbench/services/quick_input/text_provider';
import type { DisposableStore } from '../common/lifecycle';
import type { FocusCommand, InputFocusTarget } from '../input/focus';
import type { EditorActionPresentation } from './action_request';
import { captureEditorActionPresentation } from './actions';

type SourceRunMode = 'project' | 'file';
export type SourceRunSubject =
	| { readonly kind: 'project'; readonly contextId: string | undefined }
	| { readonly kind: 'file'; readonly resource: ResourceIdentity };

/** Installed execution attachments, not physical socket contents or another project's boot flag. */
function sourceRunImage(sources: RuntimeSourceState, domain: 0 | 1,
	contextId: string | undefined, mode: SourceRunMode): Blua32SourceImage | undefined {
	const image = sources.currentBlua32Media.cartridgeSlots[domain];
	if (image === null || contextId !== undefined && image.sourceContextId !== contextId) return;
	if (mode === 'project' && !sources.catalog.getContext(image.sourceContextId).luaSources.can_boot_from_source) return;
	return image;
}

export function canRunSource(sources: RuntimeSourceState, boots: BootService, tasks: RuntimeTaskQueue,
	mode: SourceRunMode, contextId: string | undefined): boolean {
	if (!boots.acceptingRequests || !tasks.ready) return false;
	for (const domain of CARTRIDGE_RESOURCE_DOMAINS) if (sourceRunImage(sources, domain, contextId, mode) !== undefined) return true;
	return false;
}

/** Choice retains its exact installed image; accepted execution belongs to the normal action/Boot owners. */
export function showSourceRunPicker(editor: CartEditor, sources: RuntimeSourceState, boots: BootService, tasks: RuntimeTaskQueue,
	runTargets: RunTargetSelection, picker: QuickInputController, subject: SourceRunSubject,
	isCurrent: () => boolean, presentation: EditorActionPresentation | undefined,
	onWillShow?: (lifetime: DisposableStore) => void, options?: QuickInputOptions): void {
	const contextId = subject.kind === 'file' ? subject.resource.contextId : subject.contextId;
	if (!isCurrent() || !boots.acceptingRequests || !tasks.ready) return;
	const projects: Array<{ domain: 0 | 1; image: Blua32SourceImage; label: string; description: string; detail: string }> = [];
	for (const domain of CARTRIDGE_RESOURCE_DOMAINS) {
		const image = sourceRunImage(sources, domain, contextId, subject.kind);
		if (image === undefined) continue;
		const context = sources.catalog.getContext(image.sourceContextId);
		projects.push({ domain, image, label: context.projectRootPath, description: `Slot ${domain}`,
			detail: subject.kind === 'file' ? subject.resource.path : 'Project entry' });
	}
	if (projects.length === 0) return;
	picker.pick(subject.kind === 'file' ? 'RUN CURRENT FILE' : 'RUN PROJECT', 'Choose cartridge slot',
		() => new TextQuickPickProvider(projects), project => {
			if (!isCurrent() || !boots.acceptingRequests || !tasks.ready
				|| sourceRunImage(sources, project.domain, contextId, subject.kind) !== project.image) return;
			editor.commands.requestAction({ action: 'run', expectedImage: project.image, selectionRequest: runTargets.request(),
				entry: subject.kind === 'file' ? { domain: project.domain, sourcePath: subject.resource.path } : { domain: project.domain },
				presentation });
		}, onWillShow, options);
}

/** A native authored client grants project launch through its real model and scope, not Scene availability. */
export function createProjectRunCommand(editor: CartEditor, sources: RuntimeSourceState, boots: BootService, tasks: RuntimeTaskQueue,
	runTargets: RunTargetSelection, model: EditorTextModel, target: InputFocusTarget, isRetained: () => boolean): FocusCommand {
	const scope = target.commandContext.scope, contextId = model.identity.contextId;
	const current = () => isRetained() && editorTextModelService.get(model.identity) === model;
	const enabled = () => current() && canRunSource(sources, boots, tasks, 'project', contextId);
	const open = (isCurrent: () => boolean, presentation: EditorActionPresentation | undefined) => showSourceRunPicker(editor, sources, boots, tasks, runTargets,
		editor.editorParts.main.quickInput, { kind: 'project', contextId }, isCurrent, presentation,
		lifetime => lifetime.add({ dispose: editorTextModelService.onWillClear(() => editor.editorParts.main.quickInput.hide(false)) }),
		{ invocationOrigin: target, commandTarget: target });
	return { contextual: true, isEnabled: enabled, run: () => open(current, captureEditorActionPresentation(target)), capture: () => {
		if (!enabled()) return;
		const generation = scope.contextGeneration, presentation = captureEditorActionPresentation(target);
		const captured = () => scope.contextGeneration === generation && current();
		return { editScope: scope, isEnabled: () => captured() && canRunSource(sources, boots, tasks, 'project', contextId),
			run: () => open(captured, presentation) };
	} };
}
