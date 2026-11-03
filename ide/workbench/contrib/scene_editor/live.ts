import type { CPU } from '../../../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';
import { sourceRangesEqual } from '../../../../toolchain/ts/lua/source_range';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeInstructionObservers } from '../../../runtime/instruction_observers';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { getTextFileRuntimeSourceInstallations } from '../../services/working_copy/runtime_source_status';
import { runtimeWorld } from '../actor_lab/runtime';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneRegistrationProvenance } from './registration_provenance';

export type SceneLiveMember = {
	readonly domain: ResourceDomain;
	readonly worldHashId: number;
	readonly sceneHashId: number;
	readonly actorHashId: number;
	readonly memberIndex: number;
	readonly generation: number;
	readonly label: string;
	readonly description: string;
	readonly detail: string;
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
	public isCurrent(member: SceneLiveMember): boolean {
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
