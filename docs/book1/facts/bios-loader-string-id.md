# Literal unary string-id result: finite source supplement

2026-10-18, baseline5b264d38a. Root directly read source; no execution claim.
For unary_string_id whose operand.kind is string_literal_expression,
literal_value returns operand.value unchanged. bind_value sets the expression's
constant_value to that returned value. Thus the literal String value, not a
numeric raw address or pointer, is the semantic constant. Source:
machine/bios/compiler/semantic.lua:18-35,251-264.
Constant preparation adds the constant_value to the guest pool. The emitter
returns its constant register; root startup GETI reads the relevant pool slot.
Sources: machine/bios/compiler/compiler.lua:61-70,151-167,1699-1715,887-922. No alternate numeric encoding is inserted by those paths.
This establishes the String result for direct &"text" / factory unary_string_id
of a string_literal node only. It does not close general &expr lowering.
