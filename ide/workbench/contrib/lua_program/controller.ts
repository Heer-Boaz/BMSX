import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, resourceIdentityEquals, type ResourceDomain, type ResourceIdentity, type RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { luaSourceRangeToTextRange, createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits, formatLuaTableFieldSource, validateLuaTableFieldExpression } from '../../../language/lua/table_field_insertion';
import type { Blua32SourceImage, RuntimeSourceState } from '../../../runtime/sources';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { luaSourceLocation } from '../../../language/lua/source_location';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import type { EditorGroupView, EditorTabOpenOptions } from '../../services/editor/editor_group';
import type { PreparedEditorInput } from '../../services/editor/editor_opening';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { collectLuaPrograms, projectLuaProgram, type LuaProgramKind, type LuaProgramOccurrence, type LuaProgramProperty } from './source';
import { LuaProgramInput } from './editor_input';
import { LuaProgramRuntimeProjection, readProgramInstances, type ProgramInstanceChoice } from './runtime';
import { programFieldTemplates, programEntryTemplate } from './schema';
import type { HostRewind } from '../../../../hosts/common/rewind';
import type { RuntimeTransport } from '../../../runtime/transport';
import { captureWorkbenchTreeView, restoreWorkbenchTreeView } from '../../ui/tree_view';
import { WorkspaceSourceContext } from '../../services/working_copy/source_context';

/** Source ownership and runtime readback meet in a retained input, never in a second program database. */
export class LuaProgramController {
	private readonly projections = new WeakMap<LuaProgramInput, LuaProgramRuntimeProjection>();
	public constructor(private readonly sources: RuntimeSourceState, public readonly guest: SuspendedGuestSession,
		private readonly rewind: HostRewind, private readonly transport: RuntimeTransport) {}
	public readonly createView = (source: LuaProgramInput): LuaProgramInput => {
		this.refresh(source);
		const view = captureWorkbenchTreeView(source.tree, element => element.key);
		const input = new LuaProgramInput(source.workingCopy, source.programKind, source.occurrenceRange, this.guest, this.createView);
		for (const [path, model] of source.sourceModels) input.sourceModels.set(path, model);
		input.publishModels();
		this.refresh(input);
		restoreWorkbenchTreeView(input.tree, view, element => element.key);
		input.sourceSelection.select(input.tree.rows[input.tree.selectionIndex], input.sourceModels);
		return input;
	};
	public open(group: EditorGroupView, quickInput: QuickInputController, kind: LuaProgramKind): void {
		quickInput.pick(kind === 'progression' ? 'PROGRESSION PROGRAMS' : 'INPUT BINDINGS', 'Choose a producer call',
			(_origin, lifetime) => {
				const retire = () => quickInput.hide();
				lifetime.add({ dispose: editorTextModelService.onDidChangeContent(retire) });
				lifetime.add({ dispose: editorTextModelService.onWillClear(retire) });
				lifetime.add({ dispose: this.sources.catalog.onDidChange(retire) });
				const choices: { label: string; description: string; detail: string; occurrence: LuaProgramOccurrence }[] = [];
				const snapshots = new Map<string, LuaSemanticWorkspaceSnapshot>();
				for (const resource of this.sources.catalog.luaResources) {
					let snapshot = snapshots.get(resource.contextId);
					if (snapshot === undefined) {
						const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId);
						project.synchronizeSources(this.sources.catalog);
						snapshot = project.getSnapshot(); snapshots.set(resource.contextId, snapshot);
					}
					for (const occurrence of collectLuaPrograms(resource, snapshot)) {
						if (occurrence.kind !== kind) continue;
						choices.push({ label: `${resource.path}:${occurrence.file.chunk.locations.range(occurrence.call.expression.span).start.line}`,
							description: kind, detail: 'Canonical Lua / unsaved working copies included', occurrence });
					}
				}
				return new TextQuickPickProvider(choices);
			}, (item, _modifiers, preserveFocus) => {
				const context = new WorkspaceSourceContext(editorTextModelService, this.sources.catalog);
				try { this.openOccurrence(group, item.occurrence, { preserveFocus, isCurrent: () => context.reason === undefined }); }
				finally { context.dispose(); }
			}, lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}
	public openResource(group: EditorGroupView, resource: RuntimeResource, kind: LuaProgramKind, options: EditorTabOpenOptions = {}): void {
		const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId);
		project.synchronizeSources(this.sources.catalog);
		const occurrence = collectLuaPrograms(resource, project.getSnapshot()).find(item => item.kind === kind)!;
		this.openOccurrence(group, occurrence, options);
	}
	public findOccurrence(group: EditorGroupView, resource: ResourceIdentity, kind: LuaProgramKind, range: Readonly<TrackedTextRange>): LuaProgramInput | undefined {
		return group.model.tabs.find((input): input is LuaProgramInput => input.kind === 'lua_program'
			&& resourceIdentityEquals(input.workingCopy.resource, resource) && input.programKind === kind
			&& input.occurrenceRange.start !== input.occurrenceRange.end
			&& input.occurrenceRange.start === range.start && input.occurrenceRange.end === range.end);
	}
	public openOccurrence(group: EditorGroupView, occurrence: LuaProgramOccurrence, options: EditorTabOpenOptions = {}): LuaProgramInput | undefined {
		return group.openPreparedEditor(() => {
			const resource = this.sources.catalog.resolveResource(occurrence.resource)!;
			const model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
			return this.prepareOccurrence(group, model, occurrence, options.isCurrent);
		}, options);
	}
	public prepareOccurrence(group: EditorGroupView, model: EditorTextModel, occurrence: LuaProgramOccurrence,
		isCurrent?: () => boolean): PreparedEditorInput<LuaProgramInput> | undefined {
		if (isCurrent?.() === false) return;
		const project = getOrCreateSemanticProject(editorTextModelService, occurrence.resource.contextId);
		if (project.getFileData(model.identity)?.revision !== occurrence.file.revision) return;
		const span = luaSourceRangeToTextRange(model.buffer, occurrence.file.chunk.locations.range(occurrence.call.expression.span));
		let input = this.findOccurrence(group, model.resource, occurrence.kind, span);
		if (input === undefined) {
			input = new LuaProgramInput(model, occurrence.kind, span, this.guest, this.createView);
			this.refresh(input);
		}
		return { input };
	}
	public refreshRuntime(input: LuaProgramInput): void {
		// Reconcile at the requested position, not an intermediate replay checkpoint.
		if (this.rewind.seeking) return;
		let projection = this.projections.get(input);
		if (projection === undefined) {
			const retained = new LuaProgramRuntimeProjection(this.sources, this.guest);
			this.projections.set(input, retained);
			input.onWillDispose(this.guest.onWillEndHistoryReview(() => retained.refresh(input, true)));
			projection = retained;
		}
		projection.refresh(input);
	}
	public resolveRuntime(input: LuaProgramInput): void { this.projections.get(input)!.resolve(input); }
	public refresh(input: LuaProgramInput): boolean {
		if (input.sourceProjecting || input.sourceSelection.retired) return false;
		input.sourceProjecting = true;
		try {
			const generation = input.sourceGeneration;
			const project = getOrCreateSemanticProject(editorTextModelService, input.workingCopy.resource.contextId);
			project.synchronizeSources(this.sources.catalog);
			const snapshot = project.getSnapshot();
			if (input.sourceRevision === snapshot.revision && input.publishedSourceGeneration === generation) return true;
			input.invalidateProjection();
			const occurrences = collectLuaPrograms(input.workingCopy.resource, snapshot);
			const occurrence = occurrences.find(item => item.kind === input.programKind && (() => {
				const range = luaSourceRangeToTextRange(input.workingCopy.buffer, item.file.chunk.locations.range(item.call.expression.span));
				return range.start === input.occurrenceRange.start && range.end === input.occurrenceRange.end;
			})());
			if (occurrence === undefined) {
				if (input.sourceSelection.retired || input.sourceGeneration !== generation || project.getSnapshot().revision !== snapshot.revision) return false;
				input.occurrence = undefined;
				input.tree.roots.length = 0; input.tree.rows.length = 0; input.tree.selectionIndex = -1;
				input.sourceSelection.reconcile(undefined, input.sourceModels);
				input.status = 'Producer call removed or incomplete; source and Undo remain available.';
				input.sourceRevision = snapshot.revision;
				input.publishedSourceGeneration = generation;
				return true;
			}
			const reader = new LuaSourceReader(snapshot);
			if (!projectLuaProgram(input.tree, occurrence, reader, file => {
				let model = input.sourceModels.get(file.file);
				if (model === undefined) {
					const resource = this.sources.catalog.resolveResource(project.getResourceIdentity(file.file))!;
					model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
					input.sourceModels.set(file.file, model);
				}
				return model;
			}, input.sourceModels, input.sourceSelection, () => !input.sourceSelection.retired && input.sourceGeneration === generation
				&& project.getSnapshot().revision === snapshot.revision)) return false;
			input.occurrence = occurrence;
			input.sourceRevision = snapshot.revision;
			input.publishedSourceGeneration = generation;
			// Previously presented documents retain this view's Save / Undo ownership
			// when an import is removed, including edits waiting to be saved or redone.
			input.publishModels();
			input.status = reader.syntaxComplete ? 'Authored Lua / Save and Hot Resume apply changes' : 'Incomplete syntax / source editing required';
			return input.sourceGeneration === generation && project.getSnapshot().revision === snapshot.revision;
		} finally { input.sourceProjecting = false; }
	}
	public getSourceLocation(input: LuaProgramInput): EditorSourceLocation | undefined {
		if (!this.refresh(input)) return;
		const row = input.liveVisible ? undefined : input.sourceSelection.property;
		const file = row?.file ?? input.occurrence?.file;
		if (file === undefined) return { model: input.workingCopy, modelVersion: input.workingCopy.version };
		const model = input.sourceModels.get(file.file)!;
		const range = file.chunk.locations.range((row?.expression ?? input.occurrence!.call.expression).span);
		return luaSourceLocation(getOrCreateSemanticProject(editorTextModelService, input.workingCopy.resource.contextId), model, file, range);
	}
	public chooseInstance(input: LuaProgramInput, quickInput: QuickInputController): void {
		input.interaction.running = false;
		const choices: Array<ProgramInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.workingCopy.resource.contextId) continue;
			for (const item of readProgramInstances(this.sources, this.guest, domain, input.programKind)) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		quickInput.pick('LIVE PROGRAM INSTANCE', 'Actual mounted contexts / components; no source-ID guess', (_origin, lifetime) => {
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, item => {
			input.instance = item.identity; input.instanceLabel = item.label; input.runtimeDomain = item.domain; input.runtimeImage = item.image;
			input.programHashId = 0; input.stateHashId = 0; input.stateRevision = -1;
			input.inspectRuntime(this.transport);
		});
	}
	public add(input: LuaProgramInput, property: LuaProgramProperty, quickInput: QuickInputController, readProperty: () => LuaProgramProperty | undefined): void {
		const target = property.table!;
		const insert = (value: string) => {
			const current = readProperty(), table = current?.table;
			if (table === undefined || !table.structural) return;
			const model = input.sourceModels.get(table.file.file)!;
			if (model.readOnly) return;
			model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, table.file.chunk, table.table, table.table.fields.length, [value]));
		};
		const entry = programEntryTemplate(input.programKind, property);
		if (entry !== undefined) {
			quickInput.input('ADD ENTRY', 'Authored Lua table', entry,
				async text => validateLuaTableFieldExpression(text), insert);
			return;
		}
		const existing = new Set(target.table.fields.map(staticLuaTableFieldName));
		const choices = programFieldTemplates(input.programKind, property).filter(item => !existing.has(item.name))
			.map(item => ({ ...item, label: item.name, description: '', detail: item.value }));
		choices.push({ name: '', value: '', label: 'Custom field', description: 'Lua table field', detail: 'Handlers, event matchers, custom commands and authored extensions' });
		quickInput.pick('ADD PROPERTY', 'Canonical Lua table field', () => {
			return new TextQuickPickProvider(choices);
		}, item => {
			if (readProperty() === undefined) return;
			quickInput.input(item.label, item.name === '' ? 'Complete Lua field: name = expression or [key] = expression' : 'Lua expression', item.value,
				async text => {
					if (item.name !== '') return formatLuaTableFieldSource(item.name, validateLuaTableFieldExpression(text));
					// Admit a complete authored table field through the same Lua grammar as source insertion.
					validateLuaTableFieldExpression(`{ ${text} }`);
					return text;
				}, insert);
		});
	}
	public remove(input: LuaProgramInput, property: LuaProgramProperty): void {
		input.tree.selectionIndex = -1;
		input.sourceModels.get(property.file.file)!.pushEditOperations(createLuaTableFieldRemovalEdits(
			input.sourceModels.get(property.file.file)!.buffer, property.file.chunk.locations, property.file.chunk.tokens, property.field!));
	}
}
