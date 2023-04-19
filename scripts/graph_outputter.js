// const dagre = require('dagre');

class Vertex {
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
        // const { matrixWidth, matrixHeight } = dagreLayout(graph, maxLabelLength);
        // const { matrixWidth, matrixHeight } = flowchartLayout(graph);
        const { matrixWidth, matrixHeight } = layeredGraphLayout(graph);
        console.log(`${matrixWidth}, ${matrixHeight}`);

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

function flowchartLayout(graph) {
    // Sort the nodes in topological order
    const sortedNodes = sortTopologically(graph);

    // Assign layers to the nodes
    const layers = [];
    let layerIndex = 0;
    sortedNodes.forEach((node) => {
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
    const visitedVertices = new Set();
    const dfs = (vertex, depth = 0) => {
        visitedVertices.add(vertex);
        vertex.pos.y = depth;

        const outgoingEdges = vertex.edges.filter(
            (edge) => edge.vertices[0] === vertex
        );
        const targetVertices = outgoingEdges.map((edge) => edge.vertices[1]);
        targetVertices.forEach((targetVertex) => {
            if (!visitedVertices.has(targetVertex)) {
                dfs(targetVertex, depth + 1);
            }
        });
    };
    graph.vertices.forEach((vertex) => {
        if (!visitedVertices.has(vertex)) {
            dfs(vertex);
        }
    });

    // Determine the width and height of the graph
    const maxX = Math.max(...graph.vertices.map((vertex) => vertex.pos.x + getNodeWidth(vertex)));
    const maxY = Math.max(...graph.vertices.map((vertex) => vertex.pos.y + getNodeHeight(vertex)));
    const matrixWidth = Math.ceil(maxX) + 20;
    const matrixHeight = Math.ceil(maxY) + 20;

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


// Example usage
const graph = new Graph();

const vertex1 = new Vertex("1", "Node 1sdfsdfsdf");
const vertex2 = new Vertex("2", "Node 2");
const vertex3 = new Vertex("3", "Node 3sdfdsfs\adflsdkfjsdfl");
const vertex4 = new Vertex("4", "Node 4");
const vertex5 = new Vertex("5", "Node 5");

graph.addVertex(vertex1);
graph.addVertex(vertex2);
graph.addVertex(vertex3);
graph.addVertex(vertex4);
graph.addVertex(vertex5);

vertex1.connectTo(vertex2);
vertex1.connectTo(vertex3);
vertex1.connectTo(vertex4);
vertex1.connectTo(vertex5);
// vertex2.connectTo(vertex3);
// vertex2.connectTo(vertex4);
// vertex2.connectTo(vertex5);
// vertex3.connectTo(vertex4);
// vertex3.connectTo(vertex5);
// vertex4.connectTo(vertex5);

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

// function dagreLayout(graph, maxLabelLength) {
//     const g = new dagre.graphlib.Graph();
//     g.setGraph({});
//     g.setDefaultEdgeLabel(() => ({}));

//     // Voeg knooppunten toe aan de dagre-grafiek
//     graph.vertices.forEach((vertex) => {
//         g.setNode(vertex.id, { width: maxLabelLength + 2, height: 3 });
//     });

//     // Voeg randen toe aan de dagre-grafiek
//     graph.vertices.forEach((vertex) => {
//         vertex.edges.forEach((edge) => {
//             const otherVertex = edge.vertices.find((v) => v !== vertex);
//             g.setEdge(vertex.id, otherVertex.id);
//         });
//     });

//     // Bereken de lay-out
//     dagre.layout(g);

//     // Wijs de berekende posities toe aan de oorspronkelijke grafiek
//     g.nodes().forEach((nodeId) => {
//         const node = g.node(nodeId);
//         const vertex = graph.getVertexById(nodeId);
//         vertex.pos = { x: node.x, y: node.y };
//     });

//     // Calculate matrix dimensions based on dagreLayout output
//     const matrixWidth = Math.ceil(g.graph().width) + 1;
//     const matrixHeight = Math.ceil(g.graph().height) + 1;
//     return { matrixWidth, matrixHeight };
// }

// function layeredGraphLayout(graph) {
//     // Sort the nodes in topological order
//     const sortedNodes = sortTopologically(graph);

//     // Assign layers to the nodes
//     const layers = [];
//     sortedNodes.forEach((node) => {
//         let layerIndex = 0;
//         while (
//             layers[layerIndex] &&
//             layers[layerIndex].some((otherNode) =>
//                 otherNode.edges.some((edge) => edge.vertices.includes(node))
//             )
//         ) {
//             layerIndex += 1;
//         }
//         node.layer = layerIndex;
//         if (!layers[layerIndex]) {
//             layers[layerIndex] = [];
//         }
//         layers[layerIndex].push(node);
//     });

//     // Position the nodes within each layer
//     layers.forEach((layer, layerIndex) => {
//         const layerWidth = Math.max(...layer.map(getNodeWidth));
//         const layerHeight = layer.reduce(
//             (sum, node) => sum + getNodeHeight(node),
//             0
//         );
//         let x = layerWidth / 2 + layerIndex * layerWidth;
//         let y = 0;
//         const connectionsByTarget = {};
//         layer.forEach((node, nodeIndex) => {
//             const layerLength = layer.length > 1 ? layer.length - 1 : 1;
//             node.pos.x = x;
//             node.pos.y = y + nodeIndex * (layerHeight / layerLength);
//             y += getNodeHeight(node);
//             x += layerWidth;

//             // Collect all outgoing edges for this node grouped by target
//             node.edges.forEach((edge) => {
//                 const target = edge.vertices[1];
//                 if (!connectionsByTarget[target.id]) {
//                     connectionsByTarget[target.id] = [];
//                 }
//                 connectionsByTarget[target.id].push(edge);
//             });
//         });

//         // Adjust y-coordinates to make the graph planar, if possible
//         Object.entries(connectionsByTarget).forEach(([targetId, outgoingEdges]) => {
//             if (outgoingEdges.length > 1) {
//                 const targetNode = graph.vertices.find((v) => v.id === targetId);
//                 const targetPos = targetNode.pos;
//                 const midIndex = Math.floor(outgoingEdges.length / 2);
//                 const midEdge = outgoingEdges[midIndex];
//                 const sourceNode = midEdge.vertices[0];
//                 const sourcePos = sourceNode.pos;
//                 const yDelta = getNodeHeight(targetNode) * 0.5;
//                 const yOffset = yDelta / (outgoingEdges.length - 1);

//                 // Move the target vertex up or down to create space for the other connections
//                 let yShift = -yDelta / 2;
//                 outgoingEdges.forEach((edge, index) => {
//                     const sourceNode = edge.vertices[0];
//                     if (!equalPos(sourceNode.pos, sourcePos)) {
//                         const sourceEdges = sourceNode.edges.filter(
//                             (e) => e.vertices[1] !== targetNode
//                         );
//                         const sourceEdgeIndex = sourceEdges.findIndex(
//                             (e) => equalPos(e.vertices[1].pos, targetPos)
//                         );
//                         const sourceEdgeCount = sourceEdges.length;
//                         const sourceYDelta = getNodeHeight(sourceNode) * 0.5;
//                         const sourceYOffset = sourceYDelta / (sourceEdgeCount - 1);
//                         const sourceYShift =
//                             -sourceYDelta / 2 + sourceEdgeIndex * sourceYOffset;
//                         targetNode.pos.y += sourceYShift - yShift;
//                     }
//                     yShift += yOffset;
//                 });
//             }
//         });
//         // Set the y-position of each node within the layer
//         layer.forEach((node) => {
//             const layerLength = layer.length > 1 ? layer.length - 1 : 1;
//             node.pos.y = node.pos.y - layerHeight / layerLength / 2;
//         });
//     });

//     // Determine the width and height of the graph
//     const maxX = Math.max(
//         ...graph.vertices.map(
//             (vertex) => vertex.pos.x + getNodeWidth(vertex)
//         )
//     );
//     const maxY = Math.max(
//         ...graph.vertices.map(
//             (vertex) => vertex.pos.y + getNodeHeight(vertex)
//         )
//     );
//     const matrixWidth = Math.ceil(maxX) + 20;
//     const matrixHeight = Math.ceil(maxY) + 20;

//     // Return the width and height of the graph
//     return { matrixWidth, matrixHeight };
// }

// function flowchartLayout(graph) {
//     // Sort the nodes in topological order
//     const sortedNodes = sortTopologically(graph);

//     // Determine the maximum width and height of each layer
//     const layerDimensions = [];
//     sortedNodes.forEach((node) => {
//         node.layer = 0;
//         const layerIndex = node.layer;
//         const nodeWidth = getNodeWidth(node);
//         const nodeHeight = getNodeHeight(node);
//         const layerWidth = layerDimensions[layerIndex]?.width ?? 0;
//         const layerHeight = layerDimensions[layerIndex]?.height ?? 0;
//         layerDimensions[layerIndex] = {
//             width: Math.max(layerWidth, nodeWidth),
//             height: layerHeight + nodeHeight,
//         };
//     });

//     // Position the nodes within each layer
//     layerDimensions.forEach((layerDimension, layerIndex) => {
//         const nodesInLayer = sortedNodes.filter((node) => node.layer === layerIndex);
//         const numNodesInLayer = nodesInLayer.length;
//         const layerWidth = layerDimension.width;
//         const layerHeight = layerDimension.height;
//         const yStart = (1 - layerHeight) / 2;
//         let xStart = (1 - layerWidth) / 2;

//         nodesInLayer.forEach((node, nodeIndex) => {
//             const nodeWidth = getNodeWidth(node);
//             const nodeHeight = getNodeHeight(node);
//             const x = xStart + (nodeWidth / 2);
//             const y = yStart + (nodeHeight / 2) + (nodeIndex / (numNodesInLayer - 1)) * (layerHeight - nodeHeight);
//             node.pos.x = x;
//             node.pos.y = y;
//         });

//         xStart += layerWidth;
//     });

//     // Determine the width and height of the graph
//     const maxX = Math.max(...graph.vertices.map((vertex) => vertex.pos.x + getNodeWidth(vertex)));
//     const maxY = Math.max(...graph.vertices.map((vertex) => vertex.pos.y + getNodeHeight(vertex)));
//     const matrixWidth = Math.ceil(maxX) + 20;
//     const matrixHeight = Math.ceil(maxY) + 20;

//     // Return the width and height of the graph
//     return { matrixWidth, matrixHeight };
// }
