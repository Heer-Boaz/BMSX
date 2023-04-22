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
class Vertex {
    constructor(id, label = '') {
        this.id = id;
        this.label = label;
        this.edges = [];
        this.pos = { x: 0, y: 0 };
    }
    connectTo(vertex, label = '') {
        const edge = new Edge(this, vertex, label);
        this.edges.push(edge);
        return edge;
    }
    print() {
        logObjectProperties(this);
    }
}
function logObjectProperties(obj, visited = new Set()) {
    for (let key in obj) {
        const value = obj[key];
        if (typeof value === 'object' && value !== null) {
            if (visited.has(value)) {
                // console.log(`${key}: [Circular]`);
            }
            else {
                visited.add(value);
                // console.log(`${key}...`);
                logObjectProperties(value, visited);
            }
        }
        else {
            console.log(`${key}: ${value}`);
        }
    }
}
class Edge {
    constructor(vertex1, vertex2, label = "") {
        this.vertices = [vertex1, vertex2];
        this.label = label;
    }
}
class Graph {
    constructor() {
        this.vertices = [];
    }
    addVertex(vertex) {
        this.vertices.push(vertex);
    }
    getVertexById(id) {
        return this.vertices.find((vertex) => vertex.id === id);
    }
    toAscii(width = 20, height = 20) {
        // Determine the maximum label length
        const maxLabelLength = this.vertices.reduce((max, vertex) => {
            return Math.max(max, vertex.label.length);
        }, 0);
        // Calculate matrix dimensions
        const { matrixWidth, matrixHeight } = layeredGraphLayout(this);
        console.log(`${matrixWidth}, ${matrixHeight}`);
        // Draw the vertices and edges on the grid
        const matrix = Array(matrixHeight)
            .fill('')
            .map(() => Array(matrixWidth).fill(" "));
        this.vertices.forEach((vertex, index) => {
            const position = {
                x: Math.round(vertex.pos.x),
                y: Math.round(vertex.pos.y),
            };
            drawVertex(matrix, vertex, position, maxLabelLength);
            if (vertex.edges.length > 0) {
                vertex.edges.forEach((edge) => {
                    const otherVertex = edge.vertices.find((v) => v !== vertex);
                    const x1 = position.x + maxLabelLength + 1;
                    const y1 = position.y + 1;
                    const x2 = Math.round(otherVertex.pos.x);
                    const y2 = Math.round(otherVertex.pos.y) + 1;
                    drawEdge(matrix, { pos: { x: x1, y: y1 } }, { pos: { x: x2, y: y2 } });
                });
            }
        });
        return matrixToASCII(matrix);
    }
}
function layeredGraphLayout(graph) {
    // Sort the nodes in topological order
    const sortedNodes = sortTopologically(graph);
    // Assign layers to the nodes
    const layers = [];
    sortedNodes.forEach((node) => {
        let layerIndex = 0;
        while (layers[layerIndex] && layers[layerIndex].some((otherNode) => otherNode.edges.some((edge) => edge.vertices.includes(node)))) {
            layerIndex += 1;
        }
        node.layer = layerIndex;
        if (!layers[layerIndex]) {
            layers[layerIndex] = [];
        }
        layers[layerIndex].push(node);
    });
    // Position the nodes within each layer
    layers.forEach((layer, layerIndex) => {
        const layerWidth = Math.max(...layer.map(getNodeWidth));
        const layerHeight = layer.reduce((sum, node) => sum + getNodeHeight(node), 0);
        let x = layerWidth / 2 + layerIndex * layerWidth;
        let y = 0;
        layer.forEach((node, nodeIndex) => {
            const layerLength = layer.length > 1 ? layer.length - 1 : 1;
            node.pos.x = x;
            node.pos.y = y + nodeIndex * (layerHeight / layerLength);
            y += getNodeHeight(node);
            x += layerWidth;
        });
    });
    // Adjust y-coordinates to make the graph planar, if possible
    // Adjust y-coordinates to make the graph planar, if possible
    for (const vertex of graph.vertices) {
        const outgoingEdges = vertex.edges.filter(edge => edge.vertices[0] === vertex);
        if (outgoingEdges.length > 1) {
            const deltaY = getNodeHeight(vertex);
            let shiftY = deltaY;
            outgoingEdges.forEach((edge, index) => {
                const targetVertex = edge.vertices.find(v => v !== vertex);
                if (index > 0) {
                    targetVertex.pos.y += shiftY;
                    shiftY += deltaY;
                }
            });
        }
    }
    // Determine the width and height of the graph
    const maxX = Math.max(...graph.vertices.map((vertex) => vertex.pos.x + getNodeWidth(vertex)));
    const maxY = Math.max(...graph.vertices.map((vertex) => vertex.pos.y + getNodeHeight(vertex)));
    const matrixWidth = Math.ceil(maxX) + 0;
    const matrixHeight = Math.ceil(maxY) + 0;
    // Return the width and height of the graph
    return { matrixWidth, matrixHeight };
}
function sortTopologically(graph) {
    const sortedNodes = [];
    const visited = new Set();
    function visit(node) {
        if (!visited.has(node)) {
            visited.add(node);
            node.edges.forEach((edge) => {
                const otherNode = edge.vertices.find((v) => v !== node);
                visit(otherNode);
            });
            sortedNodes.push(node);
        }
    }
    graph.vertices.forEach((vertex) => visit(vertex));
    return sortedNodes.reverse();
}
function getNodeWidth(node) {
    var _a, _b;
    // Return the width of the node
    return (_b = (((_a = node === null || node === void 0 ? void 0 : node.label) === null || _a === void 0 ? void 0 : _a.length) + 2)) !== null && _b !== void 0 ? _b : 12;
}
function getNodeHeight(node) {
    // Return the height of the node
    return 5;
}
function drawMatrixPixel(matrix, x, y, char, overwrite = true) {
    if (y < 0)
        return;
    if (y >= matrix.length)
        return;
    if (x < 0)
        return;
    if (x >= matrix[y].length)
        return;
    if (overwrite || (!matrix[y][x] || matrix[y][x] === " ")) {
        matrix[y][x] = char;
    }
}
function drawVertex(matrix, vertex, vertexPositionOverride, labelLengthOverride) {
    const x = vertexPositionOverride ? vertexPositionOverride.x : vertex.pos.x;
    const y = vertexPositionOverride ? vertexPositionOverride.y : vertex.pos.y;
    const labelLength = labelLengthOverride !== null && labelLengthOverride !== void 0 ? labelLengthOverride : vertex.label.length;
    const border_top = "┌" + "─".repeat(labelLength) + "┐";
    const border_bottom = "└" + "─".repeat(labelLength) + "┘";
    for (let i = 0; i < border_top.length; i++) {
        drawMatrixPixel(matrix, x + i, y, border_top[i]);
    }
    for (let i = 0; i < border_bottom.length; i++) {
        drawMatrixPixel(matrix, x + i, y + 2, border_bottom[i]);
    }
    drawMatrixPixel(matrix, x, y + 1, "|");
    drawMatrixPixel(matrix, x + labelLength + 1, y + 1, "|");
    for (let i = 1; i < labelLength + 1; i++) {
        drawMatrixPixel(matrix, x + i, y + 1, vertex.label[i - 1]);
    }
    ;
}
function matrixToASCII(matrix) {
    // Convert the grid to ASCII
    let ascii = "";
    for (let i = 0; i < matrix.length; i++) {
        ascii += matrix[i].join("") + "\n";
    }
    return ascii;
}
function drawEdge(matrix, v1, v2) {
    let x1 = Math.round(v1.pos.x);
    let y1 = Math.round(v1.pos.y);
    const x2 = Math.round(v2.pos.x);
    const y2 = Math.round(v2.pos.y);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = (x1 < x2) ? 1 : -1;
    const sy = (y1 < y2) ? 1 : -1;
    let err = dx - dy;
    while (true) {
        let char;
        if (dx > dy) {
            char = '-';
        }
        else {
            char = '|';
        }
        // Check for diagonal movement and adjust the character
        if (x1 !== x2 && y1 !== y2 && Math.abs(x1 - x2) > 2) {
            if ((x1 < x2 && y1 > y2) || (x1 > x2 && y1 < y2)) {
                char = '/';
            }
            else {
                char = '\\';
            }
        }
        if (x1 >= 0 && x1 < matrix[0].length && y1 >= 0 && y1 < matrix.length) {
            drawMatrixPixel(matrix, x1, y1, char, false);
        }
        if (x1 === x2 && y1 === y2) {
            break;
        }
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x1 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y1 += sy;
        }
    }
}
function parseStateMachineCode(code) {
    const sourceFile = ts.createSourceFile("temp.ts", code, ts.ScriptTarget.ES2020, true);
    const states = [];
    function parseNode(node) {
        var _a, _b, _c, _d, _e;
        if (ts.isClassDeclaration(node)) {
            const methods = node.members.filter(ts.isMethodDeclaration);
            for (const method of methods) {
                const decorators = ts.canHaveDecorators(method) ? ts.getDecorators(method) : undefined;
                if (decorators) {
                    for (const decorator of decorators) {
                        if (decorator.expression.getText() === "statedef_builder") {
                            const stateTransitions = [];
                            const stateProperties = {};
                            const stateFunction = method.name.getText();
                            function findStateTransitions(childNode, className) {
                                var _a, _b;
                                if (ts.isCallExpression(childNode) && childNode.expression.getText() === "this.state.to") {
                                    const toState = childNode.arguments[0].getText().replace(/'/g, "");
                                    let currentNode = childNode.parent;
                                    let input;
                                    while (currentNode && !ts.isIfStatement(currentNode)) {
                                        currentNode = currentNode.parent;
                                    }
                                    if (currentNode && ts.isIfStatement(currentNode)) {
                                        input = currentNode.expression.getText();
                                    }
                                    else {
                                        input = "No condition found";
                                    }
                                    // Find state name
                                    let fromState;
                                    const statesObject = (_b = (_a = method.body) === null || _a === void 0 ? void 0 : _a.statements.find(ts.isReturnStatement)) === null || _b === void 0 ? void 0 : _b.expression;
                                    if (statesObject && ts.isObjectLiteralExpression(statesObject)) {
                                        statesObject.properties.forEach((property) => {
                                            if (ts.isPropertyAssignment(property) && property.name.getText() === "states") {
                                                if (ts.isObjectLiteralExpression(property.initializer)) {
                                                    property.initializer.properties.forEach((innerProperty) => {
                                                        if (ts.isPropertyAssignment(innerProperty)) {
                                                            if (innerProperty.initializer.getText().includes("this.state.to('" + toState + "')")) {
                                                                fromState = innerProperty.name.getText();
                                                            }
                                                        }
                                                    });
                                                }
                                            }
                                        });
                                    }
                                    stateTransitions.push({
                                        method: method.name.getText(),
                                        input,
                                        fromState: fromState !== null && fromState !== void 0 ? fromState : "unknown",
                                        toState,
                                        stateFunction,
                                        classname: className,
                                    });
                                }
                                ts.forEachChild(childNode, childNode => findStateTransitions(childNode, className));
                            }
                            findStateTransitions(method, (_b = (_a = node.name) === null || _a === void 0 ? void 0 : _a.getText()) !== null && _b !== void 0 ? _b : 'none');
                            const returnStatement = (_c = method.body) === null || _c === void 0 ? void 0 : _c.statements.find(ts.isReturnStatement);
                            if (stateTransitions.length || Object.keys(stateProperties).length) {
                                states.push({
                                    classname: (_e = (_d = node.name) === null || _d === void 0 ? void 0 : _d.getText()) !== null && _e !== void 0 ? _e : "none",
                                    id: method.name.getText(),
                                    name: 'troep en poep',
                                    stateTransitions: stateTransitions,
                                    properties: stateProperties,
                                });
                            }
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, parseNode);
    }
    parseNode(sourceFile);
    return states;
}
function lees_args() {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        console.error('Usage: node parse_states.js <filename>');
        process.exit(1);
    }
    const fileName = args[0];
    const fileBuffer = fs.readFileSync(fileName);
    return fileBuffer.toString();
}
function main() {
    const code = lees_args();
    const parsedStates = parseStateMachineCode(code);
    const graphs = generateGraph(parsedStates);
    for (const classname in graphs) {
        console.log(`Graph for class "${classname}":`);
        const matrix = graphs[classname].toAscii();
        console.log(matrix);
    }
    parsedStates.forEach(s => { var _a; console.log(s); (_a = s.stateTransitions) === null || _a === void 0 ? void 0 : _a.forEach(t => console.log); });
    parsedStates.forEach(s => { console.log(s); }); // s.stateTransitions?.forEach(t => console.log); });
    // console.log(parsedStates);
}
function main2() {
    const code = lees_args();
    const sourceFile = ts.createSourceFile("temp.ts", code, ts.ScriptTarget.ES2020, true);
    function findStateNames(node) {
        var _a, _b;
        if (ts.isClassDeclaration(node)) {
            const classname = node.name.getText();
            for (const member of node.members) {
                if (ts.isMethodDeclaration(member) && ((_a = ts.getDecorators(member)) === null || _a === void 0 ? void 0 : _a.some(decorator => decorator.expression.getText() === "statedef_builder"))) {
                    const returnStatement = (_b = member.body) === null || _b === void 0 ? void 0 : _b.statements.find(ts.isReturnStatement);
                    if (returnStatement && ts.isReturnStatement(returnStatement)) {
                        const objectLiteralExpression = returnStatement.expression;
                        if (objectLiteralExpression && ts.isObjectLiteralExpression(objectLiteralExpression)) {
                            const statesProperty = objectLiteralExpression.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText() === "states");
                            if (statesProperty && ts.isPropertyAssignment(statesProperty)) {
                                const statesObjectLiteralExpression = statesProperty.initializer;
                                if (ts.isObjectLiteralExpression(statesObjectLiteralExpression)) {
                                    const stateNames = statesObjectLiteralExpression.properties.map(p => p.name.getText());
                                    console.log(`${classname}: ${stateNames}`);
                                }
                            }
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, findStateNames);
    }
    findStateNames(sourceFile);
}
function generateGraph(parsedStates) {
    const graphs = {};
    // Maak een Vertex-object voor elke staat en voeg deze toe aan de bijbehorende graaf
    parsedStates.forEach((state) => {
        if (!state)
            return;
        const classname = state.classname;
        if (!graphs[classname]) {
            graphs[classname] = new Graph();
        }
        const vertex = new Vertex(state.id, state.id);
        graphs[classname].addVertex(vertex);
    });
    // Verbind de Vertex-objecten op basis van hun overgangen
    parsedStates.forEach((state) => {
        if (!state.transitions)
            return;
        state.transitions.forEach((transition) => {
            const classname = state.classname;
            const fromVertex = graphs[classname].getVertexById(transition.fromState);
            const toVertex = graphs[classname].getVertexById(transition.toState);
            if (fromVertex && toVertex) {
                fromVertex.connectTo(toVertex, transition.method);
            }
        });
    });
    return graphs;
}
main2();
module.exports.func = function () {
    console.log('dsf');
};
