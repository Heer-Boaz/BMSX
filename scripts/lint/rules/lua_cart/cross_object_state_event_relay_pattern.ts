import { defineLintRule } from '../../rule';

export const crossObjectStateEventRelayPatternRule = defineLintRule('lua_cart', 'cross_object_state_event_relay_pattern');

export const crossObjectStateEventRelayPatternMessage =
	'Cross-object dispatch_state_event relay with dynamic event names is forbidden. Keep event ownership local and model transitions via FSM events/on maps.';
