import type { CellResultData } from "@plutojl/rainbow";

const BINARY_BODY_MARKER = "__pluto_binary_body_base64__";

interface EncodedBinaryBody {
  [BINARY_BODY_MARKER]: string;
  data: string;
}

function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return undefined;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}

function isEncodedBinaryBody(value: unknown): value is EncodedBinaryBody {
  return (
    value !== null &&
    typeof value === "object" &&
    BINARY_BODY_MARKER in value &&
    (value as EncodedBinaryBody)[BINARY_BODY_MARKER] === "base64" &&
    typeof (value as EncodedBinaryBody).data === "string"
  );
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Make Pluto's binary output bodies safe to pass through JSON-based VS Code APIs. */
export function serializeCellResult(result: CellResultData): CellResultData {
  const body = result.output?.body;
  const bytes = bytesOf(body);
  if (!result.output || !bytes) {
    return result;
  }

  return {
    ...result,
    output: {
      ...result.output,
      body: {
        [BINARY_BODY_MARKER]: "base64",
        data: encodeBase64(bytes),
      } satisfies EncodedBinaryBody,
    },
  };
}

/** Restore a JSON-serialized binary body before passing it to Pluto's renderer. */
export function restoreCellResult(result: CellResultData): CellResultData {
  const body = result.output?.body;
  if (!result.output || !isEncodedBinaryBody(body)) {
    return result;
  }

  return {
    ...result,
    output: {
      ...result.output,
      body: decodeBase64(body.data),
    },
  };
}
