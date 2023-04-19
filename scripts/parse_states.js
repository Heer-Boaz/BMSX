"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const ts = __importStar(require("typescript"));
const fs = require('fs');
function parseStateMachineCode(code) {
    const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.ES2020, true);
    const states = [];
    function parseNode(node) {
        var _a, _b;
        if (ts.isClassDeclaration(node)) {
            const methods = node.members.filter(ts.isMethodDeclaration);
            for (const method of methods) {
                const stateTransitions = [];
                function findStateTransitions(childNode) {
                    const expression = childNode;
                    if (ts.isCallExpression(expression) && expression.expression.getText() === 'this.state.to') {
                        // const targetState = expression.arguments[0].getText();
                        // stateTransitions.push({ input: method.name.getText(), targetState });
                        const targetState = expression.arguments[0].getText();
                        // Find the nearest IfStatement ancestor
                        let currentNode = childNode.parent;
                        let input;
                        while (currentNode && !ts.isIfStatement(currentNode)) {
                            currentNode = currentNode.parent;
                        }
                        // Get the condition text if an IfStatement is found
                        if (currentNode && ts.isIfStatement(currentNode)) {
                            input = currentNode.expression.getText();
                        }
                        else {
                            input = 'No condition found';
                        }
                        stateTransitions.push({ method: method.name.getText(), input, targetState });
                    }
                    ts.forEachChild(childNode, findStateTransitions);
                }
                findStateTransitions(method);
                if (stateTransitions.length) {
                    states.push({ classname: (_b = (_a = node.name) === null || _a === void 0 ? void 0 : _a.getText()) !== null && _b !== void 0 ? _b : 'none', name: method.name.getText(), transitions: stateTransitions });
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
