// The part of Bun's FFI the bridge uses (bun:ffi only exists in Bun; the package has no Bun types).
declare module 'bun:ffi' {
  type FFITypeName = 'i32' | 'u32' | 'i64' | 'u64' | 'ptr';
  type Signature = { readonly args: readonly FFITypeName[]; readonly returns: FFITypeName };

  /** A native argument: numbers and bigints by value; a typed array (or null) as a pointer to its memory. */
  type NativeArgument = number | bigint | ArrayBufferView | null;

  export function dlopen<Symbols extends Record<string, Signature>>(
    path: string,
    symbols: Symbols,
  ): { symbols: { [Name in keyof Symbols]: (...args: NativeArgument[]) => number | bigint }; close(): void };
}
