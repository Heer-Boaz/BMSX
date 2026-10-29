import { isMap, isSeq } from 'yaml';
import { DisposableStore } from '../../../common/lifecycle';
import { showEditorWarningBanner } from '../../../common/feedback_state';
import { aemDocumentFormat } from '../../../../toolchain/ts/rompack/aem';
import { createStructuredInsertionEdit, createStructuredRemovalEdit, type StructuredCollection, type StructuredValueEdit } from '../../../language/yaml/structured_edits';
import { editorTextModelService } from '../../../editor/model/model_service';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain, type RuntimeResource } from '../../../common/resource';
import type { Blua32SourceImage } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import { applyAemSourceRevision } from '../../../runtime/aem';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { resolveTextFileModel } from '../../services/working_copy/text_file_model';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import { projectAemSource } from './source';
import { AemEditorInput, type AemProperty } from './editor_input';
import { aemFieldTemplates, aemSequenceTemplate, aemSequenceValueTemplate } from './schema';
import { aemPropertyEditState, type AemSourceIdentity } from './source_selection';
import { mapTrackedTextRange } from '../../../editor/text/text_change';
import type { ActorLabController } from '../actor_lab/controller';
import { getTextFileRuntimeSourceInstallations } from '../../services/working_copy/runtime_source_status';

export async function resolveAemEditorInput(catalog: WorkspaceSourceCatalog, resource: RuntimeResource): Promise<AemEditorInput> {
	return new AemEditorInput(await resolveTextFileModel(editorTextModelService, catalog, resource));
}

export class AemEditorController {
	public constructor(private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession,
		private readonly runtime: Runtime, private readonly tasks: RuntimeTaskQueue,
		private readonly actorLab: ActorLabController) {}
	public open(group: EditorGroupView, quickInput: QuickInputController): void {
		quickInput.pick('AUDIO EVENT MAPS', 'Canonical YAML / JSON', (_origin, lifetime) => {
			const retire = () => quickInput.hide();
			lifetime.add({ dispose: editorTextModelService.onWillClear(retire) });
			lifetime.add({ dispose: this.sources.catalog.onDidChange(retire) });
			return new TextQuickPickProvider(this.sources.catalog.resources
				.filter(resource => resource.source.type === 'aem').map(resource => ({ label: resource.path, description: this.sources.catalog.getContext(resource.contextId).projectRootPath, detail: '', resource })));
		},
			(item, _modifiers, preserveFocus) => {
				const lifetime = new DisposableStore();
				let current = true;
				const retire = () => { current = false; };
				lifetime.add({ dispose: editorTextModelService.onWillClear(retire) });
				lifetime.add({ dispose: this.sources.catalog.onDidChange(retire) });
				void group.openResolvedEditor(() => resolveAemEditorInput(this.sources.catalog, item.resource), { preserveFocus, isCurrent: () => current })
					.catch(error => { if (current) showEditorWarningBanner(`Cannot open audio map: ${error instanceof Error ? error.message : String(error)}`); })
					.finally(() => lifetime.dispose());
			}, lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}
	public getSourceLocation(input: AemEditorInput): EditorSourceLocation {
		projectAemSource(input);
		const model = input.workingCopy, selected = input.sourceSelection.selected?.property;
		if (selected === undefined) return { model, modelVersion: input.version };
		const position = { row: 0, column: 0 };
		model.buffer.positionAt(selected.node.range![0], position);
		return { model, modelVersion: input.version,
			selection: { row: position.row, startColumn: position.column, endColumn: position.column } };
	}
	public applyPropertyEdit(input: AemEditorInput, property: AemProperty, edit: StructuredValueEdit): void {
		const identity = property.sourceIdentity, before = { id: identity.id, role: identity.role, range: { ...identity.range } };
		input.workingCopy.pushEditOperations([edit], aemPropertyEditState.of(before, input.editSource), changes => {
			const range = { ...before.range };
			if (identity.role === 'root' || identity.role === 'item') {
				range.start = edit.valueRange.start; range.end = Math.min(edit.valueRange.end, edit.valueRange.start + 1);
			} else mapTrackedTextRange(range, changes);
			return aemPropertyEditState.of({ id: identity.id, role: identity.role, range }, input.editSource);
		});
		projectAemSource(input);
	}
	public canTestEvent(input: AemEditorInput): boolean {
		if (input.sourceSelection.event === undefined) return false;
		for (const installation of getTextFileRuntimeSourceInstallations(this.sources, input.workingCopy))
			if (installation.status === 'applied' && this.actorLab.canInteract(installation.domain)) return true;
		return false;
	}
	/** Audition the captured applied event, not the pending authoring buffer accepted by ordinary blur. */
	public testEvent(input: AemEditorInput, event: AemSourceIdentity, isCurrent: () => boolean,
		group: EditorGroupView, quickInput: QuickInputController): void {
		if (!isCurrent()) return;
		const name = event.property!.eventName!;
		const choices = getTextFileRuntimeSourceInstallations(this.sources, input.workingCopy)
			.filter(installation => installation.status === 'applied' && this.actorLab.canInteract(installation.domain))
			.map(installation => ({ ...installation, label: `Physical ${installation.domain}`,
				description: input.workingCopy.resource.contextLabel, detail: name }));
		if (!isCurrent()) return;
		const provider = new TextQuickPickProvider(choices);
		quickInput.pick('AUDITION APPLIED EVENT', 'Choose the actual installed attachment', (_origin, lifetime) => {
			if (!isCurrent()) quickInput.hide();
			lifetime.add({ dispose: input.onWillDispose(() => quickInput.hide()) });
			return provider;
		}, choice => {
			if (!isCurrent()) return;
			const image = choice.domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[choice.domain];
			const rom = choice.domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.systemRom.bytes : this.sources.cartridgeSlots[choice.domain]?.rom.bytes;
			if (image !== choice.image || rom !== choice.rom || !this.actorLab.canInteract(choice.domain) || !isCurrent()) return;
			this.actorLab.auditionEvent(group, choice.domain, name);
		});
	}
	public apply(input: AemEditorInput, quickInput: QuickInputController): void {
		const resource = input.workingCopy.resource;
		const choices: Array<{ label: string; description: string; detail: string; domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== resource.contextId) continue;
			choices.push({ label: `Physical ${domain}`, description: resource.path, detail: 'Apply the current source buffer to this installed attachment', domain, image });
		}
		quickInput.pick('APPLY AUDIO EVENT MAP', 'Choose the actual installed execution attachment; Save only writes source', (_origin, lifetime) => {
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
			lifetime.add({ dispose: input.onWillDispose(() => quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, async choice => {
			const installed = choice.domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[choice.domain];
			if (installed !== choice.image) { input.applyStatus = 'Selected execution attachment was replaced; choose Apply again.'; return; }
			const source = getTextSnapshot(input.workingCopy.buffer), version = input.workingCopy.version;
			input.applying = true;
			input.applyStatus = `Applying source v${version} to physical ${choice.domain}`;
			try {
				const result = await applyAemSourceRevision(this.sources, this.guest, this.runtime, this.tasks, resource, choice.domain, choice.image, source);
				input.applyStatus = result.status === 'applied' ? `Applied source v${version} to physical ${choice.domain}`
					: result.status === 'not-applied' ? `Not applied to physical ${choice.domain}: ${result.reason}`
						: `Apply failed in ${result.phase}: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
			} finally { input.applying = false; }
		});
	}

	public audioIds(input: AemEditorInput): readonly string[] {
		return [...this.sources.catalog.getAssetBindings(input.workingCopy.resource.contextId, 'audio').keys()];
	}
	public add(input: AemEditorInput, identity: AemSourceIdentity, isCurrent: () => boolean, quickInput: QuickInputController): void {
		const property = identity.property!, collection = property.node as StructuredCollection;
		const format = aemDocumentFormat(input.workingCopy.resource.path);
		const insert = (value: string, name?: string): void => {
			if (!isCurrent()) return;
			projectAemSource(input);
			if (!isCurrent() || !this.canAdd(input, identity.property)) return;
			input.workingCopy.pushEditOperations([createStructuredInsertionEdit(input.source, format, identity.property!.node as StructuredCollection, value, name)]);
			projectAemSource(input);
		};
		if (property.path.length === 1 && property.path[0] === 'events') {
			quickInput.input('NEW AUDIO EVENT', 'Event name', 'game.effect', async name => {
				if (isCurrent() && (identity.property!.node as StructuredCollection).has(name)) throw new Error(`Event '${name}' already exists.`);
				return name;
			}, name => {
				if (!isCurrent()) return;
				quickInput.pick('EVENT AUDIO', 'Real cartridge audio asset', (_origin, lifetime) => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
				}, audio => insert(JSON.stringify({ channel: 'sfx', rules: [{ go: { audio_id: audio.label } }] }), name));
			}, lifetime => {
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
			});
			return;
		}
		if (isSeq(collection)) {
			const value = aemSequenceValueTemplate(property.path);
			if (value !== undefined) {
				quickInput.input('NEW VALUE', 'YAML / JSON value', value,
					async text => insert(text), undefined, lifetime => {
						lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					});
				return;
			}
			quickInput.pick('RULE / ACTION AUDIO', 'Choose an actual asset for the new action', (_origin, lifetime) => {
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
				return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
			}, audio => {
				if (!isCurrent()) return;
				quickInput.input('NEW AUDIO RULE / ACTION', 'YAML / JSON value', aemSequenceTemplate(identity.property!.path, audio.label),
					async text => insert(text), undefined, lifetime => {
						lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					});
			});
			return;
		}
		const choices = aemFieldTemplates(property.path, collection).filter(item => !collection.has(item.name))
			.map(item => ({ ...item, label: item.name, description: '', detail: item.value }));
		choices.push({ name: '', value: '{}', label: 'Custom property', description: 'Authored map key', detail: 'Event payload names or schema extensions' });
		quickInput.pick('ADD AUDIO PROPERTY', 'Authored event / rule / action', (_origin, lifetime) => {
			lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, item => {
			if (!isCurrent()) return;
			if (item.name === 'audio_id') {
				quickInput.pick('ACTION AUDIO', 'Real cartridge audio asset', (_origin, lifetime) => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
				}, audio => insert(JSON.stringify(audio.label), item.name));
				return;
			}
			if (item.name === '') {
				quickInput.input('PROPERTY NAME', 'Authored map key', '', async name => {
					if (isCurrent() && (identity.property!.node as StructuredCollection).has(name)) throw new Error(`Property '${name}' already exists.`);
					return name;
				}, name => {
					if (!isCurrent()) return;
					quickInput.input(name, 'YAML / JSON value', '{}', async text => insert(text, name), undefined, lifetime => {
						lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					});
				}, lifetime => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
				});
				return;
			}
			quickInput.input(item.name, 'YAML / JSON value', item.value,
				async text => insert(text, item.name), undefined, lifetime => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
				});
		});
	}
	public remove(input: AemEditorInput, property: AemProperty): void {
		input.sourceSelection.select(undefined);
		input.tree.selectionIndex = -1;
		input.workingCopy.pushEditOperations([createStructuredRemovalEdit(input.source, property.parent!, property.index!)]);
		projectAemSource(input);
	}
	public canAdd(input: AemEditorInput, property: AemProperty | undefined): boolean {
		return !input.workingCopy.readOnly && property !== undefined && (isMap(property.node) || isSeq(property.node));
	}
}
