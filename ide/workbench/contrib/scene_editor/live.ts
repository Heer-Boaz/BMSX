import type { CPU } from '../../../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';
import { sourceRangesEqual } from '../../../../toolchain/ts/lua/source_range';
import type { ResourceDomain } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { RuntimeInstructionObservers } from '../../../runtime/instruction_observers';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { getTextFileRuntimeSourceInstallations } from '../../services/working_copy/runtime_source_status';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import { findWorldActor, runtimeWorld } from '../actor_lab/runtime';
import type { SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDefinition, SceneSourceDocument } from './model';
import type { SceneSourceDocuments } from './source_documents';
import { SceneRegistrationProvenance } from './registration_provenance';

export type SceneLiveIdentity = {
	readonly domain: ResourceDomain;
	readonly worldHashId: number;
	readonly sceneHashId: number;
	readonly actorHashId: number;
	readonly memberIndex: number;
	readonly generation: number;
};
export type SceneLiveMember = SceneLiveIdentity & {
	readonly label: string;
	readonly description: string;
	readonly detail: string;
};
export type SceneLiveSource = {
	readonly member: SceneLiveIdentity;
	readonly model: EditorTextModel;
	readonly version: number;
	readonly document: SceneSourceDocument;
	readonly scene: SceneSourceDefinition;
};
export type SceneLiveSelection = {
	readonly members: readonly SceneLiveMember[];
	readonly status: 'available' | 'source-changed' | 'not-observed' | 'not-live';
};

/** Links source occurrences to plans actually published during ordinary cart
 * execution. It neither constructs Scenes nor evaluates authoring expressions.
 * Only command-time enumeration reads World; no per-frame heap/AST scan. */
export class SceneLiveService {
	private readonly observations: (SceneRegistrationProvenance | undefined)[] = [];
	private readonly subscriptions: (() => void)[] = [];
	private generation = 0;
	public constructor(private readonly cpu: CPU, private readonly sources: RuntimeSourceState,
		private readonly guest: SuspendedGuestSession, private readonly observers: RuntimeInstructionObservers) {
		this.beginExecution();
	}
	/** A replaced heap, installed program or history branch ends source evidence.
	 * Existing objects in a hot-resumed heap are not attributed to a new program. */
	public beginExecution(): void {
		this.dispose();
		for (const domain of [-1, 0, 1] as const) {
			const image = domain === -1 ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image?.symbols == null) continue;
			const observation = new SceneRegistrationProvenance(this.cpu, image, domain);
			this.observations[domain + 1] = observation;
			this.subscriptions.push(this.observers.add(observation));
		}
	}
	public select(authoring: SceneAuthoringContext): SceneLiveSelection {
		const subject = authoring.subject!, selection = authoring.selection, guest = this.guest;
		const modulePath = this.sources.catalog.resolveLuaSource(authoring.workingCopy.resource)!.record.module_path;
		const members: SceneLiveMember[] = [];
		let status: SceneLiveSelection['status'] = 'source-changed';
		for (const installation of getTextFileRuntimeSourceInstallations(this.sources, authoring.workingCopy)) {
			if (installation.status !== 'applied') continue;
			if (status === 'source-changed') status = 'not-observed';
			const observation = this.observations[installation.domain + 1];
			if (observation === undefined) continue;
			const plans = new Set<number>();
			for (const registration of observation.plans.values()) if (registration.calls.some(range => toLuaModulePath(range.path) === modulePath
				&& sourceRangesEqual({ ...range, path: subject.registrationRange.path }, subject.registrationRange))) plans.add(registration.planHashId);
			if (plans.size === 0) continue;
			status = 'not-live';
			const world = runtimeWorld(this.sources, guest, installation.domain);
			if (world === undefined) continue;
			const objects = guest.readStringMember(world, '_objects') as Table;
			for (let index = 1; index <= objects.arrayLength; index++) {
				const actor = objects.getInteger(index) as Table, scene = guest.readStringMember(actor, 'scene') as Table | null;
				if (scene === null) continue;
				const plan = guest.readStringMember(scene, 'definition') as Table;
				if (!plans.has(plan.hashId)) continue;
				const id = guest.readStringMember(actor, 'scene_member_id');
				if (id === null) continue; // Procedural children have no authored member occurrence.
				const member = (guest.readStringMember(plan, 'members_by_id') as Table).get(id);
				const memberIndex = guest.readStringMember(member, 'index') as number;
				if (selection?.kind === 'member' && memberIndex !== selection.index + 1) continue;
				members.push({ domain: installation.domain, worldHashId: world.hashId, sceneHashId: scene.hashId, actorHashId: actor.hashId,
					memberIndex, generation: this.generation, label: guest.formatValue(id),
					description: guest.formatValue(guest.readStringMember(actor, 'id')), detail: `Slot ${installation.domain} · Scene #${scene.hashId} · Actor #${actor.hashId}` });
			}
		}
		return { members, status: members.length > 0 ? 'available' : status };
	}
	/** Reverse correspondence is a command-time source query, never a hover scan.
	 * Names and the current registry cannot identify a previously compiled plan. */
	public source(domain: ResourceDomain, actorHashId: number, documents: SceneSourceDocuments): SceneLiveSource | undefined {
		const guest = this.guest, world = runtimeWorld(this.sources, guest, domain);
		const actor = findWorldActor(guest, world, actorHashId);
		if (actor === undefined) return;
		const scene = guest.readStringMember(actor, 'scene') as Table | null;
		const id = guest.readStringMember(actor, 'scene_member_id');
		if (scene === null || id === null) return; // Procedural actors have no authored member.
		const plan = guest.readStringMember(scene, 'definition') as Table;
		const registration = this.observations[domain + 1]?.plans.get(plan.hashId);
		if (registration === undefined) return;
		const memberIndex = guest.readStringMember((guest.readStringMember(plan, 'members_by_id') as Table).get(id), 'index') as number;
		const member: SceneLiveIdentity = { domain, actorHashId, worldHashId: world!.hashId, sceneHashId: scene.hashId,
			memberIndex, generation: this.generation };
		const contextId = domain === -1 ? this.sources.systemContextId : this.sources.cartridgeSlots[domain]!.contextId;
		let result: SceneLiveSource | undefined;
		for (const call of registration.calls) {
			const resource = this.sources.catalog.resolveModule(contextId, toLuaModulePath(call.path));
			if (resource === undefined) continue;
			const model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
			if (!getTextFileRuntimeSourceInstallations(this.sources, model).some(item => item.domain === domain && item.status === 'applied')) continue;
			const version = model.version, document = documents.get(model);
			for (const candidate of document.scenes) {
				if (candidate.resolution !== 'complete' || !sourceRangesEqual({ ...call, path: candidate.registrationRange.path }, candidate.registrationRange)) continue;
				if (result !== undefined && (result.model !== model || result.scene !== candidate)) return; // No guessed source for ambiguous calls.
				result = { member, model, version, document, scene: candidate };
			}
		}
		return result !== undefined && result.model.version === result.version && this.isCurrent(member) ? result : undefined;
	}
	public isCurrent(member: SceneLiveIdentity): boolean {
		if (member.generation !== this.generation) return false;
		const world = runtimeWorld(this.sources, this.guest, member.domain);
		if (world?.hashId !== member.worldHashId) return false;
		const objects = this.guest.readStringMember(world, '_objects') as Table;
		for (let index = 1; index <= objects.arrayLength; index++) {
			const actor = objects.getInteger(index) as Table;
			if (actor.hashId !== member.actorHashId) continue;
			const scene = this.guest.readStringMember(actor, 'scene') as Table | null;
			return scene?.hashId === member.sceneHashId
				&& ((this.guest.readStringMember(scene, '_members_by_index') as Table).getInteger(member.memberIndex) as Table | null)?.hashId === actor.hashId;
		}
		return false;
	}
	public dispose(): void {
		this.generation++;
		for (const release of this.subscriptions) release();
		this.subscriptions.length = 0; this.observations.length = 0;
	}
}
