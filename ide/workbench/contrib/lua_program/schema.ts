import { LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { LuaProgramKind, LuaProgramProperty } from './source';

type FieldTemplate = { readonly name: string; readonly value: string };
const PROGRESSION_ROOT: readonly FieldTemplate[] = [{ name: 'rules', value: '{}' }, { name: 'filters', value: '{}' }, { name: 'handlers', value: '{}' }];
const RULE: readonly FieldTemplate[] = [
	{ name: 'id', value: "'rule'" }, { name: 'on', value: "'game.event'" }, { name: 'when_all', value: '{}' },
	{ name: 'when_event', value: '{}' }, { name: 'set', value: '{}' }, { name: 'apply', value: '{}' }, { name: 'apply_once', value: 'true' },
];
const INPUT_ROOT: readonly FieldTemplate[] = [{ name: 'bindings', value: '{}' }, { name: 'eval', value: "'first'" }];
const BINDING: readonly FieldTemplate[] = [{ name: 'on', value: "{ press = 'a[jp]' }" }, { name: 'go', value: "{ press = { ['effect.trigger'] = 'effect' } }" },
	{ name: 'when', value: '{}' }, { name: 'priority', value: '0' }];
const INPUT_ON: readonly FieldTemplate[] = [{ name: 'press', value: "'a[jp]'" }, { name: 'hold', value: "'a[p]'" },
	{ name: 'release', value: "'a[jr]'" }, { name: 'custom', value: '{}' }, { name: 'combo', value: "{ steps = { 'a[jp]', 'a[jp]' } }" }];
const INPUT_GO: readonly FieldTemplate[] = ['press', 'hold', 'release', 'combo'].map(name => ({ name, value: "{ ['effect.trigger'] = 'effect' }" }));
const WHEN: readonly FieldTemplate[] = [{ name: 'mode', value: "{ tag = 'mode' }" }];
const CONDITION: readonly FieldTemplate[] = [{ name: 'key', value: "'flag'" }, { name: 'equals', value: 'true' }];
const SET: readonly FieldTemplate[] = [{ name: 'key', value: "'flag'" }, { name: 'value', value: 'true' }];
const CUSTOM: readonly FieldTemplate[] = [{ name: 'name', value: "'custom'" }, { name: 'pattern', value: "'a[jp]'" }];
const MODE: readonly FieldTemplate[] = [{ name: 'path', value: "'/state'" }, { name: 'tag', value: "'mode'" }, { name: 'not', value: 'false' }];
const COMBO: readonly FieldTemplate[] = [{ name: 'steps', value: "{ 'a[jp]', 'a[jp]' }" }, { name: 'cancel', value: "'b[jp]'" }];
const KEYBOARD: readonly FieldTemplate[] = [{ name: 'keyboard', value: "'command'" }, { name: 'submit', value: 'true' }];

/** Authoring choices follow cartlib's schema; they are never runtime default values. */
export function programFieldTemplates(kind: LuaProgramKind, property: LuaProgramProperty): readonly FieldTemplate[] {
	const path = property.path, field = path[path.length - 1], container = path[path.length - 2];
	const entry = property.field?.kind === LuaTableFieldKind.Array;
	if (path.length === 0) return kind === 'progression' ? PROGRESSION_ROOT : INPUT_ROOT;
	if (kind === 'progression') {
		if (path.length === 2 && path[0] === 'rules' && entry) return RULE;
		if (entry && (path.length === 4 && path[0] === 'rules' && container === 'when_all' || path.length === 3 && path[0] === 'filters')) return CONDITION;
		if (entry && path.length === 4 && path[0] === 'rules' && container === 'set') return SET;
	} else {
		if (path[0] !== 'bindings') return [];
		if (path.length === 2 && entry) return BINDING;
		if (path.length === 3) {
			if (field === 'on') return INPUT_ON;
			if (field === 'go') return INPUT_GO;
			if (field === 'when') return WHEN;
		}
		if (entry && path.length === 5 && path[2] === 'on' && container === 'custom') return CUSTOM;
		if (path[2] === 'when' && (path.length === 4 && field === 'mode' || path.length === 5 && entry && container === 'mode')) return MODE;
		if (path.length === 4 && path[2] === 'on' && field === 'combo') return findNamedLuaTableField(property.table!.table, 'keyboard') === null ? COMBO : KEYBOARD;
	}
	return [];
}
export function programEntryTemplate(kind: LuaProgramKind, property: LuaProgramProperty): string | undefined {
	const path = property.path, field = path[path.length - 1];
	if (kind === 'progression') {
		if (path.length === 1 && field === 'rules') return "{ id = 'new_rule', on = 'game.event', when_all = {}, set = {}, apply = {}, apply_once = false }";
		if (path.length === 3 && path[0] === 'rules') {
			if (field === 'when_all') return "{ key = 'flag', equals = true }";
			if (field === 'set') return "{ key = 'flag', value = true }";
			if (field === 'apply') return "{ op = 'handler' }";
		}
		if (path.length === 2 && path[0] === 'filters' && property.field?.kind === LuaTableFieldKind.Array) return "{ key = 'flag', equals = true }";
		if (path.length === 1 && field === 'filters') return "{ { key = 'flag', equals = true } }";
	} else {
		if (path.length === 1 && field === 'bindings') return "{ on = { press = 'a[jp]' }, go = { press = { ['effect.trigger'] = 'effect' } } }";
		if (path.length === 4 && path[0] === 'bindings' && path[2] === 'on' && field === 'custom') return "{ name = 'custom', pattern = 'a[jp]' }";
		if (path.length === 5 && path[0] === 'bindings' && path[2] === 'on' && path[3] === 'combo' && field === 'steps') return "'a[jp]'";
	}
}
