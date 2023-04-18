const dagre = require("dagre");

class Vertex {
    constructor(id, label = "") {
        this.id = id;
        this.label = label;
        this.edges = [];
    }

    connectTo(vertex, label = "") {
        const edge = new Edge(this, vertex, label);
        this.edges.push(edge);
        return edge;
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

    toAscii(width = 80, height = 40) {
        // Determine the maximum label length
        const maxLabelLength = this.vertices.reduce((max, vertex) => {
            return Math.max(max, vertex.label.length);
        }, 0);

        // Calculate matrix dimensions
        const { matrixWidth, matrixHeight } = dagreLayout(graph);

        // Draw the vertices and edges on the grid
        const matrix = Array(matrixHeight)
            .fill()
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

function equalPos(pos1, pos2) {
    return pos1.x === pos2.x && pos1.y === pos2.y;
}

function dagreLayout(graph) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => ({}));

    // Voeg knooppunten toe aan de dagre-grafiek
    graph.vertices.forEach((vertex) => {
        g.setNode(vertex.id, { width: 80, height: 30 });
    });

    // Voeg randen toe aan de dagre-grafiek
    graph.vertices.forEach((vertex) => {
        vertex.edges.forEach((edge) => {
            const otherVertex = edge.vertices.find((v) => v !== vertex);
            g.setEdge(vertex.id, otherVertex.id);
        });
    });

    // Bereken de lay-out
    dagre.layout(g);

    // Wijs de berekende posities toe aan de oorspronkelijke grafiek
    g.nodes().forEach((nodeId) => {
        const node = g.node(nodeId);
        const vertex = graph.getVertexById(nodeId);
        vertex.pos = { x: node.x, y: node.y };
    });

    // Calculate matrix dimensions based on dagreLayout output
    const matrixWidth = Math.ceil(g.graph().width) + 1;
    const matrixHeight = Math.ceil(g.graph().height) + 1;
    return { matrixWidth, matrixHeight };
}


function drawMatrixPixel(matrix,x, y,  char) {
    if (y < 0) return;
    if (y >= matrix.length) return;
    if (x < 0) return;
    if (!matrix[y]) throw `${y}`;
    if (x >= matrix[y].length) return;

    matrix[y][x] = char;
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
        if (x1 !== x2 && y1 !== y2) {
            char = '°';
            if ((x1 < x2 && y1 > y2) || (x1 > x2 && y1 < y2)) {
                char = '°';
            }
        }

        if (x1 >= 0 && x1 < matrix[0].length && y1 >= 0 && y1 < matrix.length) {
            if (!matrix[y1][x1] || matrix[y1][x1] === " ") {
                matrix[y1][x1] = char;
            }
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

// Example usage
const graph = new Graph();

const vertex1 = new Vertex("1", "Node 1");
const vertex2 = new Vertex("2", "Node 2");
const vertex3 = new Vertex("3", "Node 3");

graph.addVertex(vertex1);
graph.addVertex(vertex2);
graph.addVertex(vertex3);

vertex1.connectTo(vertex2);
vertex1.connectTo(vertex3);
vertex3.connectTo(vertex1);
vertex2.connectTo(vertex3);

console.log(graph.toAscii());


// function forceDirectedLayout(graph, iterations = 10, width = 80, height = 40) {
//     const k = Math.sqrt(1 / graph.vertices.length);
//     const c = 0.01;
//     // Initialize the positions and velocities of the vertices
//     graph.vertices.forEach((vertex) => {
//         vertex.pos = { x: Math.random() * width, y: Math.random() * height };
//         vertex.vel = { x: 0, y: 0 };
//     });

//     // Run the simulation
//     for (let i = 0; i < iterations; i++) {
//         // Calculate the forces acting on each vertex
//         graph.vertices.forEach((vertex) => {
//             let forceX = 0;
//             let forceY = 0;

//             // Calculate the repulsive force between each pair of vertices
//             // if (graph.vertices.some(v => !v.pos.x || !v.pos.y)) throw "sdfsdfdsf";
//             graph.vertices.forEach((otherVertex) => {
//                 if (vertex != otherVertex && !equalPos(vertex.pos, otherVertex.pos)) {
//                     const deltaX = vertex.pos.x - otherVertex.pos.x;
//                     const deltaY = vertex.pos.y - otherVertex.pos.y;
//                     const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);
//                     // if (Number.isNaN(distance))  throw `i:${i} - ${distance}: ${deltaX}, ${deltaY} - ${vertex.pos.x}, ${vertex.pos.y} - ${otherVertex.pos.x}, ${otherVertex.pos.y}`;
//                     const repulsiveForce = k ** 2 / distance ** 2;
//                     forceX += (deltaX / distance) * repulsiveForce;
//                     forceY += (deltaY / distance) * repulsiveForce;
//                     if (Number.isNaN(forceX)) throw `#${i} --- ${vertex.label}(${vertex.pos.x},${vertex.pos.y}) : ${otherVertex.label}(${otherVertex.pos.x},${otherVertex.pos.y})`;
//                 }
//             });

//             // Calculate the attractive force between connected vertices
//             vertex.edges.forEach((edge) => {
//                 const otherVertex = edge.vertices.find((v) => v !== vertex && !equalPos(v, vertex));
//                 if (!otherVertex) return;
//                 const deltaX = otherVertex.pos.x - vertex.pos.x;
//                 const deltaY = otherVertex.pos.y - vertex.pos.y;
//                 if (Number.isNaN(deltaX)) throw 'delta-X';
//                 if (Number.isNaN(deltaY)) throw 'delta-Y';
//                 const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);
//                 const attractiveForce = distance ** 2 / k;
//                 if (Number.isNaN(distance)) throw 'distance';
//                 if (Number.isNaN(attractiveForce)) throw 'attractiveForce';
//                 forceX += (deltaX / distance) * attractiveForce;
//                 forceY += (deltaY / distance) * attractiveForce;
//                 if (Number.isNaN(forceX)) throw `force-X: (${deltaX} / ${distance}) * ${attractiveForce} - ${vertex.label} : ${otherVertex.label}`;
//                 if (Number.isNaN(forceY)) throw 'force-Y';
//             });

//             // Apply the forces to the vertex
//             vertex.vel.x = (vertex.vel.x + forceX) * (1 - c);
//             vertex.vel.y = (vertex.vel.y + forceY) * (1 - c);
//             // vertex.pos.x += vertex.vel.x;
//             // vertex.pos.y += vertex.vel.y;
//             // Apply the forces to the vertex
//             if (Number.isNaN(vertex.vel.x) || Number.isNaN(vertex.vel.y)) throw 'dsgsdfsdg';
//             console.log('Before:');
//             console.log(vertex.pos.x);
//             console.log(vertex.pos.y);
//             vertex.pos.x = Math.min(Math.max(vertex.pos.x + vertex.vel.x, 0), width - 1);
//             vertex.pos.y = Math.min(Math.max(vertex.pos.y + vertex.vel.y, 0), height - 1);
//             console.log('After:');
//             console.log(vertex.pos.x);
//             console.log(vertex.pos.y);
//         });
//     }
// }
