import * as ts from 'typescript';
const fs = require('fs');
class Vertex {
    id: any;
    label: string;
    edges: any[];
    pos: { x: number; y: number; };
    constructor(id, label = '') {
        this.id = id;
        this.label = label;
        this.edges = [];
        this.pos = { x: 0, y: 0 };
    }

    connectTo(vertex, label = '') {
        const edge = new Edge(this, vertex, label);
        this.edges.push(edge)
            ;
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
            } else {
                visited.add(value);
                // console.log(`${key}...`);
                logObjectProperties(value, visited);
            }
        } else {
            console.log(`${key}: ${value}`);
        }
    }
}

class Edge {
    vertices: any[];
    label: string;
    constructor(vertex1, vertex2, label = "") {
        this.vertices = [vertex1, vertex2];
        this.label = label;
    }
}

class Graph {
    vertices: any[];
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
                    const otherVertex = edge.vertices.find(
                        (v) => v !== vertex
                    );
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
    // Return the width of the node
    return (node?.label?.length + 2) ?? 12;
}

function getNodeHeight(node) {
    // Return the height of the node
    return 5;
}

function drawMatrixPixel(matrix, x, y, char, overwrite = true) {
    if (y < 0) return;
    if (y >= matrix.length) return;
    if (x < 0) return;
    if (x >= matrix[y].length) return;

    if (overwrite || (!matrix[y][x] || matrix[y][x] === " ")) {
        matrix[y][x] = char;
    }
}

function drawVertex(matrix, vertex, vertexPositionOverride, labelLengthOverride) {
    const x = vertexPositionOverride ? vertexPositionOverride.x : vertex.pos.x;
    const y = vertexPositionOverride ? vertexPositionOverride.y : vertex.pos.y;
    const labelLength = labelLengthOverride ?? vertex.label.length;
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
    };
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
        } else {
            char = '|';
        }

        // Check for diagonal movement and adjust the character
        if (x1 !== x2 && y1 !== y2 && Math.abs(x1 - x2) > 2) {
            if ((x1 < x2 && y1 > y2) || (x1 > x2 && y1 < y2)) {
                char = '/';
            } else {
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

type State = {
    classname: string;
    id: string;
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
                    states.push({ classname: node.name?.getText() ?? 'none', id: 'sadsf', name: method.name.getText(), transitions: stateTransitions });
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
const g = generateGraph(parsedStates);
console.log(g);
const matrix = g.toAscii();
console.log(matrix);

// parsedStates.forEach(s => { console.log(s); s.transitions.forEach(t => console.log); });
// console.log(parsedStates);
function generateGraph(parsedStates) {
    const graph = new Graph();

    // Maak een Vertex-object voor elke staat en voeg deze toe aan de graaf
    parsedStates.forEach((state) => {
        if (!state) return;
        const vertex = new Vertex(state.id, state.name);
        graph.addVertex(vertex);
    });

    // Verbind de Vertex-objecten op basis van hun overgangen
    parsedStates.forEach((state) => {
        state.transitions.forEach((transition) => {
            const fromVertex = graph.getVertexById(transition.id);
            const toVertex = graph.getVertexById(transition.targetState);
            if (fromVertex && toVertex) {
                fromVertex.connectTo(toVertex, transition.method);
            }
        });
    });

    return graph;
}

module.exports.func = function () {
    console.log('dsf');
};