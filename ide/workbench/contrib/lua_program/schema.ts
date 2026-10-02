import type { LuaProgramKind } from './source';

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
	{ name: 'release', value: "'a[jr]'" }, { name: 'custom', value: '{}' }, { name: 'combo', value: '{}' }];

/** Authoring choices follow cartlib's schema; they are never runtime default values. */
export function programFieldTemplates(kind: LuaProgramKind, path: string): readonly FieldTemplate[] {
	if (path === 'root') return kind === 'progression' ? PROGRESSION_ROOT : INPUT_ROOT;
	if (kind === 'progression' && /^root\/rules\/\[\d+\]$/.test(path)) return RULE;
	if (kind === 'input' && /^root\/bindings\/\[\d+\]$/.test(path)) return BINDING;
	if (kind === 'input' && path.endsWith('/on')) return INPUT_ON;
	if (kind === 'input' && path.endsWith('/go')) return ['press', 'hold', 'release', 'combo'].map(name => ({ name, value: "{ ['effect.trigger'] = 'effect' }" }));
	return [];
}
export function programEntryTemplate(kind: LuaProgramKind, path: string): string | undefined {
	if (kind === 'progression') {
		if (path === 'root/rules') return "{ id = 'new_rule', on = 'game.event', when_all = {}, set = {}, apply = {}, apply_once = false }";
		if (path.endsWith('/when_all')) return "{ key = 'flag', equals = true }";
		if (path.endsWith('/set')) return "{ key = 'flag', value = true }";
		if (path.endsWith('/apply')) return "{ op = 'handler' }";
		if (path === 'root/filters') return "{ { key = 'flag', equals = true } }";
	} else {
		if (path === 'root/bindings') return "{ on = { press = 'a[jp]' }, go = { press = { ['effect.trigger'] = 'effect' } } }";
		if (path.endsWith('/custom')) return "{ name = 'custom', pattern = 'a[jp]' }";
	}
}
