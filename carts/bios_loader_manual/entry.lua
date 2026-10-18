module<entry>

local storage<const> = require('results')
local result<const>: *bios_loader_manual_result = storage.result
local observations<const> = storage.observations

-- Compilation returns a closure without running the source statements.
local environment<const> = { total = 0, step = 3 }
observations.environment = environment
observations.loaded, observations.load_error = load(
	'total = total + step return total', 'manual.environment', 't', environment)
result.environment_before = environment.total
result.environment_first = observations.loaded()
environment.step = 5
result.environment_second = observations.loaded()
print('Load environment', result.environment_before,
	result.environment_first, result.environment_second, environment.total)

-- An external binding is selected before the environment's same-spelling key.
observations.binding = { available = true, is_type = false, is_const = false,
	value = 10 }
observations.external_environment = { external_value = 1000, step = 2 }
observations.external_chunk = load(
	'external_value = external_value + step return external_value',
	'manual.external', 't', observations.external_environment, {
		names = { external_value = observations.binding },
		read = function(binding) return binding.value end,
		write = function(binding, value) binding.value = value end,
	})
result.external_first = observations.external_chunk()
result.external_second = observations.external_chunk()
print('Load external scope', result.external_first, result.external_second,
	observations.binding.value, observations.external_environment.external_value)

-- Without an environment, use an ordinary global owned by this cartridge.
setglobal('bios_loader_manual_counter', 5)
observations.global_chunk = load(
	'bios_loader_manual_counter = bios_loader_manual_counter + 2 '
		.. 'return bios_loader_manual_counter', 'manual.global', 't')
result.global_first = observations.global_chunk()
result.global_second = observations.global_chunk()
print('Load globals', result.global_first, result.global_second,
	getglobal('bios_loader_manual_counter'))

-- Retain the returned child rather than retaining its root factory closure.
local capture_environment<const> = { offset = 10 }
observations.child = load(
	'return function(value) return value + offset end',
	'manual.capture', 't', capture_environment)()
result.capture_first = observations.child(5)
capture_environment.offset = 20
result.capture_second = observations.child(5)
print('Load child', result.capture_first, result.capture_second)

-- Mode is a membership scan for lowercase t, not an exact-name comparison.
observations.mode_chunk = load('return 21 * 2', 'manual.mode', 'not-a-mode')
result.mode_value = observations.mode_chunk()
observations.binary_chunk, observations.binary_error =
	load('return 1', 'manual.binary', 'b')
observations.false_mode_chunk, observations.false_mode_error =
	load('return 1', 'manual.false_mode', false)
print('Load modes', result.mode_value, observations.binary_chunk,
	observations.binary_error)
print('Load false mode', observations.false_mode_chunk,
	observations.false_mode_error)

-- A supplied false environment is not the omitted/nil environment branch.
observations.false_environment, observations.false_environment_message =
	load('return missing', 'manual.false_environment', 't', false)
observations.false_environment_ok, observations.false_environment_error =
	pcall(observations.false_environment)
print('Load false environment', observations.false_environment_message,
	observations.false_environment_ok, observations.false_environment_error)

-- Source errors are returned by load; calling a loaded closure is separate.
observations.invalid_chunk, observations.invalid_error =
	load('return @', 'manual.invalid', 't')
print('Load source error', observations.invalid_chunk, observations.invalid_error)

observations.bare = load('return', 'manual.bare', 't')
observations.fallthrough = load('', 'manual.empty', 't')
result.bare_count = select('#', observations.bare())
result.fallthrough_count = select('#', observations.fallthrough())
print('Load nil results', result.bare_count, observations.bare(),
	result.fallthrough_count, observations.fallthrough())

local tuple_environment<const> = {
	pair = function() return 3, nil, 9 end,
}
observations.expanded = load(
	'return pair()', 'manual.expanded', 't', tuple_environment)
observations.single = load(
	'return (pair())', 'manual.single', 't', tuple_environment)
result.expanded_count = select('#', observations.expanded())
result.single_count = select('#', observations.single())
observations.first, observations.middle, observations.last = observations.expanded()
print('Load result expansion', result.expanded_count, result.single_count,
	observations.first, observations.middle, observations.last)

-- Use the installed factory, not hand-encoded AST nodes or instruction words.
local factory<const> = lua_compiler.syntax_factory
local syntax<const> = factory.syntax
observations.syntax_chunk = lua_compiler.compile_syntax(
	factory.chunk(factory.block({
		factory.return_statement({
			factory.binary_expression(syntax.binary_multiply,
				factory.number_literal(6), factory.number_literal(7)),
		}),
	})), 'manual.syntax')
result.factory_value = observations.syntax_chunk()
print('Load syntax factory', result.factory_value)

-- Share a symbol key, but create a fresh node for every syntax occurrence.
local symbol<const> = factory.generated_symbol('value')
observations.symbol_chunk = lua_compiler.compile_syntax(
	factory.chunk(factory.block({
		factory.local_statement(factory.reference(symbol),
			factory.number_literal(5), false),
		factory.assignment_statement(factory.reference(symbol),
			factory.binary_expression(syntax.binary_add,
				factory.reference(symbol), factory.number_literal(2))),
		factory.return_statement({ factory.reference(symbol) }),
	})), 'manual.symbol')
result.symbol_value = observations.symbol_chunk()
print('Load generated symbol', result.symbol_value)

-- compile_syntax has no load-style nil/error wrapper of its own.
observations.syntax_ok, observations.syntax_error = pcall(
	lua_compiler.compile_syntax,
	factory.chunk(factory.block({ factory.break_statement() })),
	'manual.invalid_syntax')
print('Load syntax error', observations.syntax_ok, observations.syntax_error)

result.completed = 1
while true do
	halt_until_irq
end
