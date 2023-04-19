import * as ts from 'typescript';
const fs = require('fs');

type State = {
    classname: string;
    name: string;
    transitions: Array<Transition>;
};

type Transition = {
    method: string;
    input: string;
    targetState: string;
};

function parseStateMachineCode(code: string) {
    const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.ES2020, true);
    const states: State[] = [];

    function parseNode(node: ts.Node) {
        if (ts.isClassDeclaration(node)) {
            const methods: ts.MethodDeclaration[] = node.members.filter(ts.isMethodDeclaration);

            for (const method of methods) {
                const stateTransitions: Transition[] = [];
                function findStateTransitions(childNode: ts.Node) {
                    const expression = childNode;
                    if (ts.isCallExpression(expression) && expression.expression.getText() === 'this.state.to') {
                        // const targetState = expression.arguments[0].getText();
                        // stateTransitions.push({ input: method.name.getText(), targetState });
                        const targetState = expression.arguments[0].getText();

                        // Find the nearest IfStatement ancestor
                        let currentNode: ts.Node | undefined = childNode.parent;
                        let input: string | undefined;
                        while (currentNode && !ts.isIfStatement(currentNode)) {
                            currentNode = currentNode.parent;
                        }

                        // Get the condition text if an IfStatement is found
                        if (currentNode && ts.isIfStatement(currentNode)) {
                            input = currentNode.expression.getText();
                        } else {
                            input = 'No condition found';
                        }

                        stateTransitions.push({ method: method.name.getText(), input, targetState });
                    }
                    ts.forEachChild(childNode, findStateTransitions);
                }

                findStateTransitions(method);
                if (stateTransitions.length) {
                    states.push({ classname: node.name?.getText() ?? 'none', name: method.name.getText(), transitions: stateTransitions });
                }
            }
        }

        ts.forEachChild(node, parseNode);
    }

    parseNode(sourceFile);
    return states;
}

// Example usage
const args = process.argv.slice(2);

if (args.length !== 1) {
    console.error('Usage: node parse_states.js <filename>');
    process.exit(1);
}

const fileName = args[0];
const fileBuffer = fs.readFileSync(fileName);
const code = fileBuffer.toString();

// const code = `/* Your TypeScript code containing the draaischijf class */`;

const parsedStates = parseStateMachineCode(code);
parsedStates.forEach(s => { console.log(s); s.transitions.forEach(t => console.log); });
// console.log(parsedStates);

module.exports.func = function () {
    console.log('dsf');
};