// function compressBase64(base64String) {
//     let compressedString = "";
//     let searchBuffer = "";
//     let nextIndex = 0;
//     let matchIndex = -1;
//     let matchLength = 0;

//     while (nextIndex < base64String.length) {
//         // zoek het langste matchende string in het zoekbuffer
//         let longestMatch = "";
//         let longestMatchIndex = -1;
//         for (let i = 0; i < searchBuffer.length; i++) {
//             let match = searchBuffer.substr(i);
//             if (base64String.startsWith(match)) {
//                 if (match.length > longestMatch.length) {
//                     longestMatch = match;
//                     longestMatchIndex = i;
//                 }
//             }
//         }

//         // Voeg de match toe aan de gecomprimeerde string, of voeg de volgende teken toe aan het zoekbuffer
//         if (longestMatch.length > 0) {
//             compressedString += "(" + longestMatchIndex + "," + longestMatch.length + ")";
//             searchBuffer += longestMatch + base64String.charAt(nextIndex + longestMatch.length);
//             nextIndex += longestMatch.length + 1;
//         } else {
//             compressedString += base64String.charAt(nextIndex);
//             searchBuffer += base64String.charAt(nextIndex);
//             nextIndex++;
//         }

//         // Houd de grootte van het zoekbuffer onder controle
//         if (searchBuffer.length > 256) {
//             searchBuffer = searchBuffer.substr(searchBuffer.length - 256);
//         }
//     }

//     return compressedString;
// }
const fs = require('fs');
const zlib = require('zlib');

const wavFile = fs.readFileSync('./src/testrom/res/_ignore/bassdrum.wav');
const gzipped = zlib.gzipSync(wavFile);
const base64Encoded = gzipped.toString('base64');

console.log(base64Encoded);
console.log(`grootte=${wavFile.length}; nieuwe grootte=${base64Encoded.length}`);
