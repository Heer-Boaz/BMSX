// type State = {
//     name: string;
//     transitions: Array<{
//         input: string;
//         targetState: string;
//     }>;
// };

// function generateStateMachineCode(states: State[]): string {
//     let code = '';

//     // Generate state definitions
//     for (const state of states) {
//         code += `const ${state.name} = new sdef('${state.name}', {\n`;

//         for (const transition of state.transitions) {
//             code += `  process_input: (s: sstate) => {\n`;
//             code += `    if (${transition.input}) {\n`;
//             code += `      this.state.to('${transition.targetState}');\n`;
//             code += `    }\n`;
//             code += `  },\n`;
//         }

//         code += '});\n\n';
//     }

//     // Generate state machine object
//     code += 'const stateMachine = {\n';
//     code += '  states: {\n';

//     for (const state of states) {
//         code += `    ${state.name}: ${state.name},\n`;
//     }

//     code += '  },\n';
//     code += '};\n\n';

//     return code;
// }

// // Example usage
// const states: State[] = [
//     {
//         name: 'idle',
//         transitions: [
//             {
//                 input: 'Input.KD_BTN1',
//                 targetState: 'slijpen_opstart',
//             },
//         ],
//     },
//     {
//         name: 'slijpen_opstart',
//         transitions: [
//             {
//                 input: '!Input.KD_BTN1',
//                 targetState: 'slijpen_afkoel',
//             },
//         ],
//     },
//     {
//         name: 'slijpen',
//         transitions: [
//             {
//                 input: '!Input.KD_BTN1',
//                 targetState: 'slijpen_afkoel',
//             },
//         ],
//     },
//     {
//         name: 'slijpen_afkoel',
//         transitions: [
//             {
//                 input: 'Input.KD_BTN1',
//                 targetState: 'slijpen_opstart',
//             },
//         ],
//     },
// ];

// console.log(generateStateMachineCode(states));
