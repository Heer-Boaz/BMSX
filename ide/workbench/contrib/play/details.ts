import type { ScenarioSourceLocation } from '../../../testing/scenario/result_service';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import type { PlayHandle } from '../../services/play/service';
import { extractErrorMessage } from '../../../common/errors';

export type PlayDetailsProperty = InspectedProperty & { readonly location?: ScenarioSourceLocation };

/** Snapshot only on explicit inspection; none of this formatting belongs to frame execution. */
export function describePlaySession(handle: PlayHandle): readonly PlayDetailsProperty[] {
	const session = handle.session;
	const properties: PlayDetailsProperty[] = [
		{ label: 'Fixture', value: handle.module.path, description: `Captured source revision ${handle.sourceRevision}`, warning: false },
		{ label: 'State', value: handle.state, description: 'Independent physical machine', warning: false },
	];
	const failure = handle.failure ?? (session?.failure?.kind === 'host' ? session.failure : undefined);
	if (failure !== undefined) {
		const error = failure.error;
		properties.push({ label: handle.failure === undefined ? 'Host failure' : 'Preparation failure',
			value: extractErrorMessage(error), description: '', warning: true });
		if (error instanceof Error && error.stack !== undefined)
			properties.push({ label: 'Stack trace', value: error.stack, description: '', warning: true });
	}
	if (session === undefined) return properties;
	if (session.failure?.kind === 'machine') properties.push({ label: 'Machine fault', value: session.failure.message,
		description: `Frame ${session.failure.videoTick} / cycles ${session.failure.cycles}`, warning: true });
	for (const context of session.fixture.failures) properties.push({ label: context.failure.phase, value: context.failure.message,
		description: context.failure.stackTrace, location: context.failure.location, warning: true });
	const evidence = session.evidence;
	properties.push({ label: 'Live epoch', value: String(evidence.epoch), description: 'Restore starts a new live trace; hidden replay is not recorded.', warning: false });
	for (let index = 0; index < evidence.captures.length; index++) {
		const capture = evidence.captures.at(index);
		properties.push({ label: capture.label, value: capture.sequence === undefined ? 'Pending' : `Frame ${capture.sequence}`,
			description: `Requested at frame ${capture.requestedTick}`, warning: false });
	}
	for (let index = 0; index < evidence.logs.length; index++) {
		const log = evidence.logs.at(index);
		properties.push({ label: `Frame ${log.tick}`, value: log.text, description: 'Fixture log', warning: false });
	}
	if (evidence.fsmTrace !== undefined) {
		for (let index = 0; index < evidence.fsmTrace.facts.length; index++) {
			const fact = evidence.fsmTrace.facts.at(index);
			properties.push({ label: `FSM ${fact.lane}`, value: `${fact.previous} -> ${fact.target} / ${fact.outcome}`,
				description: `Frame ${fact.tick} / sequence ${fact.sequence}`, warning: fact.outcome === 'rejected' });
		}
		if (evidence.droppedFsmFacts !== 0) properties.push({ label: 'FSM', value: `${evidence.droppedFsmFacts} expired records`, description: 'Producer retention window', warning: true });
	}
	if (evidence.effectTrace !== undefined) {
		for (let index = 0; index < evidence.effectTrace.facts.length; index++) {
			const fact = evidence.effectTrace.facts.at(index);
			properties.push({ label: `Effect ${fact.effect}`, value: fact.kind === 'trigger' ? fact.outcome : `${fact.kind} / ${fact.count}`,
				description: `Frame ${fact.tick} / sequence ${fact.sequence}`, warning: false });
		}
		if (evidence.droppedEffectFacts !== 0) properties.push({ label: 'Effects', value: `${evidence.droppedEffectFacts} expired records`, description: 'Producer retention window', warning: true });
	}
	return properties;
}
