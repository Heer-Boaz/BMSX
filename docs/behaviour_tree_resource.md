# Authored Behavior Tree resource v1

`*.bt.jsonc` is the canonical text format for visually authorable Behavior
Trees. It is a BT-specific document, not a generic graph DTO and not a machine
asset type. The format follows the text-backed custom-editor lifecycle used by
VS Code, Microsoft's source-range-preserving JSONC parser and the
validate-before-instantiation split in BehaviorTree.CPP. The pinned production
references and the product-level ownership decision are recorded in
[`studio_functional_design.md`](studio_functional_design.md#selected-combination-d--e--typed-jsonc-resources).

This slice owns source parsing, validation and cooking only. Cart-side decode,
binding and `program.compile` admission belong to `BT-RESOURCE-ADMISSION-01`.
The visual editor belongs to `STUDIO-BT-VISUAL-EDITOR-01` after that admission
contract exists.

## Ownership and identity

- `(execution domain, resource path)` identifies the text document.
- `definition_id` is the semantic tree id consumed by cart code.
- Every blackboard entry, node, Service and decorator has one canonical
  lowercase UUID in `id`. UUIDs are unique across the whole document.
- Array order is semantic for child nodes, weighted choices, Services and
  decorators. Source offsets, names and array indices are not identity.
- Optional node `name` is authored presentation data. Version 1 has no shared
  graph-layout fields; view selection, collapse, hover, pan and zoom are never
  document data.
- `version` versions the authored JSONC contract. `format_version` versions the
  cooked payload independently, so an editor-only source evolution does not
  silently change the cart contract.

Comments and trailing commas are accepted. Unknown and duplicate properties
are errors rather than ignored extension bags. The packer never rewrites or
normalizes the source document.

## Document shape

The root object contains:

| Property | Required | Meaning |
| --- | --- | --- |
| `version` | yes | Authored schema version; currently `1`. |
| `definition_id` | yes | Non-empty semantic tree id. |
| `blackboard` | no | Ordered blackboard-entry array. |
| `root` | yes | One Behavior Tree node. |

A blackboard entry contains `id`, a unique non-empty `name`, and
`initial_value`. Version 1 values are strings, finite numbers or booleans.
`null`, arrays and objects are intentionally not values: Lua `nil` cannot be a
retained table value, and richer value representations require their own
machine/cart contract rather than an untyped JSON escape hatch.

Every node contains `id` and `type`, and may contain `name`, `services` and
`decorators`. Its remaining properties are determined by `type`:

| `type` | Required properties | Optional properties |
| --- | --- | --- |
| `sequence` | non-empty `children` | common properties |
| `selector` | non-empty `children` | common properties |
| `random_selector` | non-empty `children` | common properties |
| `weighted_random_selector` | non-empty `choices`; each choice has positive-integer `weight` and `child` | common properties |
| `simple_parallel` | `finish_mode`, `main_task`, `background_tree` | common properties |
| `task` | non-empty `binding` | positive-integer `interval_ticks`, common properties |
| `timeline` | non-empty `timeline_id` | `play_options`, common properties |
| `wait` | `duration_ticks`, or both `minimum_duration_ticks` and `maximum_duration_ticks` | common properties |
| `set_blackboard` | blackboard UUID and scalar `value` | common properties |
| `add_blackboard` | blackboard UUID and numeric `value` | common properties |

`finish_mode` is `abort_background` or `wait_for_background`. The main branch
of `simple_parallel` must be one Task placement. In the live BMSX definition
model that includes the callback-backed `task` plus the built-in `timeline`,
`wait`, `set_blackboard` and `add_blackboard` Tasks; composites are rejected.
`background_tree` accepts any node.

A fixed Wait accepts a non-negative integer `duration_ticks`. A ranged Wait
requires non-negative minimum and maximum values with minimum not greater than
maximum. Timeline `play_options` contains only the declarative scalar options
`rewind`, `snap_to_start` and positive `play_rate`; runtime target, binding and
parameter objects remain cart-owned.

## Attachments

A Service contains a UUID `id`, a non-empty cart `binding`, and these optional
placement policies:

- `interval`: positive integers `period_units` and `units_per_tick`;
- `tick_on_search_start`;
- `restart_timer_on_each_activation`.

Whether a bound Service callback requires an interval is a manifest-dependent
admission rule, not a JSON-shape guess made by the packer.

Decorator shapes are:

| `type` | Required properties | Optional properties |
| --- | --- | --- |
| `condition` | UUID `id`, cart `binding` | `observer_aborts`: `none` or `self` |
| `blackboard` | UUID `id`, blackboard UUID, `operation` | comparison `value`, `observer_aborts`, `notify_observer` |
| `loop` | UUID `id`, exactly one of `infinite_loop: true` or positive-integer `num_loops` | none |

Blackboard operations are `equal`, `not_equal`, `less`, `less_or_equal`,
`greater`, `greater_or_equal`, `is_set` and `is_not_set`. The first six require
`value`; the last two reject it. Blackboard observer modes are `none`, `self`,
`lower_priority` and `both`; notify modes are `result_change` and
`value_change`. A node has at most one loop decorator.

## Cooked ordinary data

Rompack validates the complete document before cooking it with the existing
binary data serializer. Cooking is deterministic and performs these ownership
transitions:

| Authored JSONC | Cooked data |
| --- | --- |
| `version` | independent `format_version` |
| element `id` | omitted |
| node `name` | omitted |
| callback `binding` | `binding_id` |
| blackboard UUID reference | semantic `key` name |
| ordered semantic fields | retained in source order |

The resulting TOC record is simply `data`. It has the normal generated
`bmsx/assets` address and length symbols and introduces no Behavior Tree,
Studio or JSONC knowledge in the machine, cartridge bus, TOC or C++ runtime.
There is no generated Lua module and no JSON parser in the cart frame path.
