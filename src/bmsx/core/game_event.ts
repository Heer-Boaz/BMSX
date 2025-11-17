import type { Identifiable } from '../rompack/rompack';
import { $ } from './game';

export type EventLane = 'any' | 'gameplay' | 'presentation';
export type EventPayload = Record<string, any>;

type BaseEvent<TType extends string> = {
	type: TType;
	lane: EventLane;
	timestamp: number;
	emitter: Identifiable | null;
};

export type GameEvent<TType extends string = string, TDetail extends object = {}> = BaseEvent<TType> & TDetail;

type GameEventInit<TType extends string, TDetail extends object> = {
	type: TType;
	lane?: EventLane;
	emitter?: Identifiable | null;
} & TDetail;

export function createGameEvent<TType extends string, TDetail extends object = {}>(init: GameEventInit<TType, TDetail>): GameEvent<TType, TDetail> {
	if (!init || !init.type) {
		throw new Error('[GameEvent] type is required.');
	}
	const { type, lane = 'gameplay', emitter = null, ...detail } = init;
	return {
		type,
		lane,
		emitter,
		timestamp: $.platform.clock.now(),
		...(detail as TDetail),
	};
}
