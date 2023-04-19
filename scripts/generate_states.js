function generateStateMachineCode(states) {
    var code = '';
    // Generate state definitions
    for (var _i = 0, states_1 = states; _i < states_1.length; _i++) {
        var state = states_1[_i];
        code += "const ".concat(state.name, " = new sdef('").concat(state.name, "', {\n");
        for (var _a = 0, _b = state.transitions; _a < _b.length; _a++) {
            var transition = _b[_a];
            code += "  process_input: (s: sstate) => {\n";
            code += "    if (".concat(transition.input, ") {\n");
            code += "      this.state.to('".concat(transition.targetState, "');\n");
            code += "    }\n";
            code += "  },\n";
        }
        code += '});\n\n';
    }
    // Generate state machine object
    code += 'const stateMachine = {\n';
    code += '  states: {\n';
    for (var _c = 0, states_2 = states; _c < states_2.length; _c++) {
        var state = states_2[_c];
        code += "    ".concat(state.name, ": ").concat(state.name, ",\n");
    }
    code += '  },\n';
    code += '};\n\n';
    return code;
}
// Example usage
var states = [
    {
        name: 'idle',
        transitions: [
            {
                input: 'Input.KD_BTN1',
                targetState: 'slijpen_opstart'
            },
        ]
    },
    {
        name: 'slijpen_opstart',
        transitions: [
            {
                input: '!Input.KD_BTN1',
                targetState: 'slijpen_afkoel'
            },
        ]
    },
    {
        name: 'slijpen',
        transitions: [
            {
                input: '!Input.KD_BTN1',
                targetState: 'slijpen_afkoel'
            },
        ]
    },
    {
        name: 'slijpen_afkoel',
        transitions: [
            {
                input: 'Input.KD_BTN1',
                targetState: 'slijpen_opstart'
            },
        ]
    },
];
console.log(generateStateMachineCode(states));
