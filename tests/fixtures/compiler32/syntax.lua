require('base')
local api<const> = require('compiler/api')
local factory<const> = api.syntax_factory
local raw<const> = require('test/raw')
local chunk<const> = factory.chunk(factory.block({factory.return_statement({
factory.number_literal(2),factory.number_literal(2.0),factory.number_literal(-0.0),factory.number_literal(0.0),
factory.number_literal(raw.decode(0x7fa12345)),factory.number_literal(raw.decode(0xffa12345)),factory.number_literal(raw.decode(0x7fc00000))
})}))
local compiled<const> = api.compile_syntax(chunk,'raw-floats')
return compiled()
