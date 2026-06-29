import { readFile, writeFile } from "node:fs/promises";

export const GL_FLOAT = 5126;
export const GL_UNSIGNED_SHORT = 5123;
export const GL_UNSIGNED_INT = 5125;
export const GL_ARRAY_BUFFER = 34962;
export const GL_ELEMENT_ARRAY_BUFFER = 34963;

export function padBuffer(buffer, byte = 4, fill = 0) {
  const paddingLength = (byte - (buffer.length % byte)) % byte;
  return paddingLength === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(paddingLength, fill)]);
}

export function readGlbChunks(glb) {
  const magic = glb.subarray(0, 4).toString("ascii");
  const version = glb.readUInt32LE(4);
  const declaredLength = glb.readUInt32LE(8);

  if (magic !== "glTF" || version !== 2 || declaredLength !== glb.length) {
    throw new Error("GLB 模型格式无效，无法读取");
  }

  const chunks = [];
  let offset = 12;

  while (offset < glb.length) {
    const chunkLength = glb.readUInt32LE(offset);
    const chunkType = glb.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkStart = offset + 8;
    chunks.push({
      type: chunkType,
      data: glb.subarray(chunkStart, chunkStart + chunkLength),
    });
    offset = chunkStart + chunkLength;
  }

  return chunks;
}

export function parseGlb(glb) {
  const chunks = readGlbChunks(glb);
  const jsonChunk = chunks.find((chunk) => chunk.type === "JSON");
  const binaryChunk = chunks.find((chunk) => chunk.type === "BIN\0");

  if (!jsonChunk || !binaryChunk) {
    throw new Error("GLB 模型缺少 JSON 或 BIN 数据块");
  }

  return {
    gltf: JSON.parse(jsonChunk.data.toString("utf8")),
    binary: binaryChunk.data,
  };
}

export async function readGlbFile(path) {
  return parseGlb(await readFile(path));
}

export function createGlbFromChunks(gltf, binaryChunk) {
  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(gltf)), 4, 0x20);
  const binBuffer = padBuffer(binaryChunk);
  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.write("JSON", 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuffer.length, 0);
  binHeader.write("BIN\0", 4);

  return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]);
}

export async function writeGlbFile(path, gltf, binaryChunk) {
  await writeFile(path, createGlbFromChunks(gltf, binaryChunk));
}

export function createFloatBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

export function createIndexBuffer(values) {
  const useUint32 = values.some((value) => value > 65535);
  const buffer = Buffer.alloc(values.length * (useUint32 ? 4 : 2));
  values.forEach((value, index) => {
    if (useUint32) {
      buffer.writeUInt32LE(value, index * 4);
    } else {
      buffer.writeUInt16LE(value, index * 2);
    }
  });

  return {
    buffer,
    componentType: useUint32 ? GL_UNSIGNED_INT : GL_UNSIGNED_SHORT,
  };
}
