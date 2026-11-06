// Reassemble small static files losslessly. Callers verify the original payload hash.
export async function fetchAsset(payload, root) {
  const parts = payload.parts ?? [{ file: payload.file }];
  if (!Array.isArray(parts) || !parts.length || parts.some(p => typeof p.file !== 'string')) {
    throw new Error('Invalid asset part manifest');
  }
  const abort = new AbortController();
  const buffers = new Array(parts.length);
  let next = 0;
  async function worker() {
    while (next < parts.length) {
      const i = next++, part = parts[i];
      const response = await fetch(new URL(part.file, root), { signal: abort.signal });
      if (!response.ok) throw new Error(`Asset part download failed: ${part.file}`);
      const bytes = await response.arrayBuffer();
      if (part.byte_length !== undefined && bytes.byteLength !== part.byte_length) {
        throw new Error(`Asset part size mismatch: ${part.file}`);
      }
      buffers[i] = new Uint8Array(bytes);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(6, parts.length) }, worker));
  } catch (error) {
    abort.abort();
    throw error;
  }
  const size = buffers.reduce((sum, b) => sum + b.length, 0);
  if (payload.packed_byte_length !== undefined && size !== payload.packed_byte_length) {
    throw new Error('Packed asset size mismatch');
  }
  const packed = new Uint8Array(size);
  let offset = 0;
  for (const bytes of buffers) { packed.set(bytes, offset); offset += bytes.length; }
  let result = packed.buffer;
  if (payload.compression === 'gzip') {
    result = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } else if (payload.compression) {
    throw new Error('Unsupported asset compression');
  }
  if (payload.byte_length !== undefined && result.byteLength !== payload.byte_length) {
    throw new Error('Unpacked asset size mismatch');
  }
  return result;
}
