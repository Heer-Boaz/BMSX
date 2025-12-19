import type { Identifiable } from '../rompack/rompack';
import { $ } from './engine_core';

export type EventPayload = Record<string, any>;

type BaseEvent<TType extends string> = {
	type: TType;
	timestamp: number;
	emitter: Identifiable;
};

export type GameEvent<TType extends string = string, TDetail extends object = {}> = BaseEvent<TType> & TDetail;

type GameEventInit<TType extends string, TDetail extends object> = {
	type: TType;
	emitter?: Identifiable;
} & TDetail;

export function create_gameevent<TType extends string, TDetail extends object = {}>(init: GameEventInit<TType, TDetail>): GameEvent<TType, TDetail> {
	if (!init || !init.type) {
		throw new Error('[GameEvent] type is required.');
	}
	const { type, emitter = null, ...detail } = init;
	return {
		type,
		emitter,
		timestamp: $.platform.clock.now(),
		...(detail as TDetail),
	};
}
