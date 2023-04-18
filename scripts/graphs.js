// Definieer ASCII-art string van een diagram met nodes en edges
const asciiArt = `
+--------------+      +----------------------------+
|  Task 1      |      |     Task 2                 |
|   (length:2) +----->+    (power:5, firend:"blap")|
+--------------+      +----------------------------+
                          |
                          |
                          v
+--------------+      +--------------------------+
|  Task 3      |      |     Task 4               |
|  (data:'B')  +----->+     (bla4:'dfgdfgdfg')   |
+--------------+      +--------------------------+
    |                             |
    |                             |
    v                             v
+--------------+                +--------------------------+
|  Task 5      |                |     Task 6               |
|  (peroew:'a',+--------------->+     (lsdfd:'E',          |
|   blup:34324)|                |     sdfsdffsd:'sdfsdf')  |
+--------------+                +--------------------------+`;

function extractBoxes(asciiArt) {
    const lines = asciiArt.split('\n');
    let boxes = [];
    for (let i = 0; i < lines.length; i++) {
        const matches = lines[i].matchAll(/\+-{2,}\+/g);
        for (const match of matches) {
            const box = {
                x: match.index,
                y: i,
                width: match[0].length,
                height: 0,
                text: [],
            };

            for (let j = i + 1; j < lines.length; j++) {
                const row = lines[j].substring(box.x, box.x + box.width);
                if (row === '+'.padEnd(box.width - 1, '-') + '+') {
                    box.height = j - box.y;
                    break;
                }
                box.text.push(row);
            }
            boxes.push(box);
        }
    }
    return boxes;
}

function parseBoxes(boxes) {
    const nodes = boxes.map((box) => {
        const taskMatch = box.text.find((line) => line.match(/\bTask\s+\d+\b/));
        if (taskMatch) {
            const dataMatches = box.text.filter((line) => line.match(/(\w+:(?:\d+|'[\w\s]+'))/));
            const taskInfo = taskMatch.match(/(Task \d+)/);
            const taskId = taskInfo[1];
            const taskData = [];
            dataMatches.forEach((match) => {
                const matchData = match.match(/(\w+:(?:\d+|'[\w\s]+'))/g);
                taskData.push(...matchData);
            });
            return { id: taskId, data: taskData, x: box.x, y: box.y };
        }
    });
    return nodes.filter((node) => node !== undefined && node.id);
}

function findHorizontalConnections(lines, tasks) {
    const connections = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const arrowMatch = line.match(/([^-]+)-->([^-]+)/);
        const pipeMatch = line.match(/([^-]+)\|([^-]+)/);

        if (arrowMatch) {
            const from = tasks.find((task) => arrowMatch[1].indexOf(task.id) !== -1);
            const to = tasks.find((task) => arrowMatch[2].indexOf(task.id) !== -1);
            if (from && to) {
                connections.push({ from: from.id, to: to.id });
            }
        }

        if (pipeMatch) {
            const from = tasks.find((task) => pipeMatch[1].indexOf(task.id) !== -1);
            const to = tasks.find((task) => pipeMatch[2].indexOf(task.id) !== -1);
            if (from && to) {
                connections.push({ from: from.id, to: to.id });
            }
        }
    }
    return connections;
}

function findVerticalConnections(lines, tasks) {
    const connections = [];

    for (let i = 0; i < tasks.length - 1; i++) {
        const fromTask = tasks[i];
        const toTask = tasks[i + 1];

        const fromTaskLastLine = fromTask.y + fromTask.height;
        const toTaskFirstLine = toTask.y;

        let isVerticalConnection = true;

        for (let j = fromTaskLastLine + 1; j < toTaskFirstLine; j++) {
            if (!lines[j].charAt(fromTask.x).match(/[|v]/)) {
                isVerticalConnection = false;
                break;
            }
        }

        if (isVerticalConnection) {
            connections.push({ from: fromTask.id, to: toTask.id });
        }
    }

    return connections;
}

// function findVerticalConnections(lines, tasks) {
//     const connections = new Set();

//     // Zoek de breedte van elke kolom
//     const columnWidths = tasks.map(task => task.width);

//     for (let i = 0; i < lines.length; i++) {
//         const line = lines[i];
//         const isConnectionLine = line.includes('v') || line.includes('|');
//         if (isConnectionLine) {
//             // Zoek de positie van de lijn ten opzichte van de kolommen
//             const positions = getColumnPositions(line);
//             for (let j = 0; j < positions.length - 1; j++) {
//                 // Controleer of de lijn tussen twee kolommen ligt
//                 if (positions[j] + 1 === positions[j + 1]) {
//                     const taskAbove = findTaskAbove(i, j, tasks, lines, columnWidths);
//                     const taskBelow = findTaskBelow(i, j, tasks, lines, columnWidths);
//                     if (taskAbove && taskBelow) {
//                         connections.add(`${taskAbove.id}-${taskBelow.id}`);
//                     }
//                 }
//             }
//         }
//     }

//     return [...connections].map(conn => {
//         const [from, to] = conn.split('-');
//         return { from, to };
//     });
// }

// // Zoek de positie van elke kolom in de regel
// function getColumnPositions(line) {
//     const positions = [];
//     let currentPosition = 0;
//     while (true) {
//         const nextPosition = line.indexOf('+', currentPosition + 1);
//         if (nextPosition === -1) {
//             break;
//         }
//         positions.push(nextPosition);
//         currentPosition = nextPosition;
//     }
//     return positions;
// }

// function findTaskAbove(startIndex, columnIndex, tasks, lines, columnWidths) {
//     for (let i = startIndex - 1; i >= 0; i--) {
//         const line = lines[i];
//         const task = tasks.find((t) => line.substring(columnWidths.slice(0, columnIndex).reduce((acc, val) => acc + val, 0), columnWidths.slice(0, columnIndex + 1).reduce((acc, val) => acc + val, 0)).includes(t.id));
//         if (task) {
//             return task;
//         }
//     }
//     return null;
// }

// function findTaskBelow(startIndex, columnIndex, tasks, lines, columnWidths) {
//     for (let i = startIndex + 1; i < lines.length; i++) {
//         const line = lines[i];
//         const task = tasks.find((t) => line.substring(columnWidths.slice(0, columnIndex).reduce((acc, val) => acc + val, 0), columnWidths.slice(0, columnIndex + 1).reduce((acc, val) => acc + val, 0)).includes(t.id));
//         if (task) {
//             return task;
//         }
//     }
//     return null;
// }



function parseAsciiArt(asciiArt) {
    const lines = asciiArt.split('\n');
    const boxes = extractBoxes(asciiArt);
    const tasks = parseBoxes(boxes);
    const connections = findHorizontalConnections(lines, tasks);
    connections.push(...findVerticalConnections(lines, tasks));
    console.log(findVerticalConnections(lines, tasks));

    return {
        tasks: tasks.reduce((acc, task) => {
            acc[task.id] = task.data;
            return acc;
        }, {}),
        connections: connections,
    };
}

const diagramJson = parseAsciiArt(asciiArt);
console.log(JSON.stringify(diagramJson, null, 2));
