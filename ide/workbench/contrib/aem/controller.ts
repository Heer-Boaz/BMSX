import { isMap, isSeq } from 'yaml';
import { showEditorWarningBanner } from '../../../common/feedback_state';
import { aemDocumentFormat } from '../../../../toolchain/ts/rompack/aem';
import { createStructuredInsertionEdit, createStructuredRemovalEdit, type StructuredCollection } from '../../../language/yaml/structured_edits';
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
import { resolveTextCodeEditorInput } from '../../ui/code_tab/io';
import { AemEditorInput } from './editor_input';
import { aemFieldTemplates, aemSequenceTemplate, aemSequenceValueTemplate } from './schema';

export async function resolveAemEditorInput(catalog: WorkspaceSourceCatalog, resource: RuntimeResource): Promise<AemEditorInput> {
	return new AemEditorInput(await resolveTextFileModel(editorTextModelService, catalog, resource));
}

export class AemEditorController {
	public constructor(private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession,
		private readonly runtime: Runtime, private readonly tasks: RuntimeTaskQueue) {}
	public open(group: EditorGroupView, quickInput: QuickInputController): void {
		quickInput.pick('AUDIO EVENT MAPS', 'Canonical YAML / JSON', () => new TextQuickPickProvider(this.sources.catalog.resources
			.filter(resource => resource.source.type === 'aem').map(resource => ({ label: resource.path, description: this.sources.catalog.getContext(resource.contextId).projectRootPath, detail: '', resource }))),
			item => {
				void group.openResolvedEditor(resolveAemEditorInput(this.sources.catalog, item.resource))
					.catch(error => showEditorWarningBanner(`Cannot open audio map: ${error instanceof Error ? error.message : String(error)}`));
			}, lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}
	public openSource(group: EditorGroupView, input: AemEditorInput): void {
		const selected = input.tree.rows[input.tree.selectionIndex]?.element;
		const position = { row: 0, column: 0 };
		if (selected !== undefined) input.workingCopy.buffer.positionAt(selected.node.range![0], position);
		void group.openResolvedEditor(resolveTextCodeEditorInput(this.sources.catalog, input.workingCopy.resource),
			{ selection: { row: position.row, startColumn: position.column, endColumn: position.column } })
			.catch(error => showEditorWarningBanner(`Cannot open audio source: ${error instanceof Error ? error.message : String(error)}`));
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
	public add(input: AemEditorInput, quickInput: QuickInputController): void {
		const property = input.tree.rows[input.tree.selectionIndex]?.element ?? input.tree.roots[0].element;
		const collection = property.node as StructuredCollection;
		const format = aemDocumentFormat(input.workingCopy.resource.path);
		const insertion = (value: string, name?: string) => createStructuredInsertionEdit(input.source, format, collection, value, name);
		if (property.path.length === 1 && property.path[0] === 'events') {
			quickInput.input('NEW AUDIO EVENT', 'Event name', 'game.effect', async name => {
				if (collection.has(name)) throw new Error(`Event '${name}' already exists.`);
				return name;
			}, name => {
				quickInput.pick('EVENT AUDIO', 'Real cartridge audio asset', (_origin, lifetime) => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
				}, audio => input.workingCopy.pushEditOperations([insertion(JSON.stringify({ channel: 'sfx', rules: [{ go: { audio_id: audio.label } }] }), name)]));
			}, lifetime => {
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
			});
			return;
		}
		if (isSeq(collection)) {
			const value = aemSequenceValueTemplate(property.path);
			if (value !== undefined) {
				quickInput.input('NEW VALUE', 'YAML / JSON value', value,
					async text => insertion(text), edit => input.workingCopy.pushEditOperations([edit]), lifetime => {
						lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					});
				return;
			}
			quickInput.pick('RULE / ACTION AUDIO', 'Choose an actual asset for the new action', (_origin, lifetime) => {
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
				return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
			}, audio => {
				quickInput.input('NEW AUDIO RULE / ACTION', 'YAML / JSON value', aemSequenceTemplate(property.path, audio.label),
					async text => insertion(text), edit => input.workingCopy.pushEditOperations([edit]), lifetime => {
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
			if (item.name === 'audio_id') {
				quickInput.pick('ACTION AUDIO', 'Real cartridge audio asset', (_origin, lifetime) => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					return new TextQuickPickProvider(this.audioIds(input).map(id => ({ label: id, description: '', detail: '' })));
				}, audio => input.workingCopy.pushEditOperations([insertion(JSON.stringify(audio.label), item.name)]));
				return;
			}
			if (item.name === '') {
				quickInput.input('PROPERTY NAME', 'Authored map key', '', async name => {
					if (collection.has(name)) throw new Error(`Property '${name}' already exists.`);
					return name;
				}, name => {
					quickInput.input(name, 'YAML / JSON value', '{}', async text => insertion(text, name), edit => input.workingCopy.pushEditOperations([edit]), lifetime => {
						lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					});
				}, lifetime => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
				});
				return;
			}
			quickInput.input(item.name, 'YAML / JSON value', item.value,
				async text => insertion(text, item.name), edit => input.workingCopy.pushEditOperations([edit]), lifetime => {
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => quickInput.hide()) });
				});
		});
	}
	public remove(input: AemEditorInput): void {
		const property = input.tree.rows[input.tree.selectionIndex].element;
		input.tree.selectionIndex = -1;
		input.workingCopy.pushEditOperations([createStructuredRemovalEdit(input.source, property.parent!, property.index!)]);
	}
	public canAdd(input: AemEditorInput): boolean {
		const property = input.tree.rows[input.tree.selectionIndex]?.element ?? input.tree.roots[0]?.element;
		return !input.workingCopy.readOnly && property !== undefined && (isMap(property.node) || isSeq(property.node));
	}
}
