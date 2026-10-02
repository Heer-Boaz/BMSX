import { quoteLuaString } from '../../../../../toolchain/ts/lua/syntax/string_literal';
import { DEFAULT_NEW_LUA_RESOURCE_CONTENT } from '../../../../common/constants';

export type NewLuaSourceKind = 'empty' | 'action_effect' | 'progression' | 'input';

/** Starting source, not a second authoring format or a runtime default. Cart code owns installation. */
export function newLuaSource(kind: NewLuaSourceKind, relativePath: string): string {
	if (kind === 'empty') return DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	if (kind === 'action_effect') return `local actioneffects<const> = require('cartlib/actioneffects')
local effect_id<const> = ${quoteLuaString(relativePath.slice(0, -4))}
actioneffects.register_effect(effect_id, {
\thandler = function(owner, payload)
\tend,
})
return effect_id
`;
	if (kind === 'progression') return `local progression<const> = require('cartlib/progression')
local definition<const> = {}
definition.program, definition.filters = progression.compile_program({
\trules = {},
\tfilters = {},
\thandlers = {},
})
-- Import this module and mount definition.program on the cart-owned context.
return definition
`;
	return `local input_component<const> = require('cartlib/input/actioneffect/actioneffect_component')
return input_component.factory({
\tprogram = {
\t\tbindings = {},
\t},
})
`;
}
