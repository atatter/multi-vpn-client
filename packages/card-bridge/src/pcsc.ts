import { dlopen } from 'bun:ffi';

/**
 * The OS's smart card API (PC/SC) through Bun's FFI: winscard.dll on Windows, PCSC.framework on
 * macOS, pcsc-lite on Linux. They share one API, but their integer sizes differ: DWORD is 64 bits
 * in pcsc-lite on 64-bit Linux (unsigned long) and 32 bits elsewhere; handles are pointer-sized on
 * Windows, 64 bits in pcsc-lite and 32 bits on macOS.
 */

interface Abi {
  library: string;
  /** Windows has ANSI ("A") and wide variants of the functions that take strings. */
  suffix: '' | 'A';
  /**
   * How reader names are encoded. Windows' ANSI functions use the system code page, so names are kept
   * byte for byte (latin1): decoding them as UTF-8 would garble "é" and connecting to the name would fail.
   */
  names: 'latin1' | 'utf8';
  dword: 'u32' | 'u64';
  handle: 'u64' | 'i32' | 'i64';
  result: 'i32' | 'i64';
}

const ABIS: Partial<Record<NodeJS.Platform, Abi>> = {
  win32: { library: 'winscard.dll', suffix: 'A', names: 'latin1', dword: 'u32', handle: 'u64', result: 'i32' },
  darwin: { library: '/System/Library/Frameworks/PCSC.framework/PCSC', suffix: '', names: 'utf8', dword: 'u32', handle: 'i32', result: 'i32' },
  linux: { library: 'libpcsclite.so.1', suffix: '', names: 'utf8', dword: 'u64', handle: 'i64', result: 'i64' },
};

// Result codes (the same everywhere, as unsigned 32-bit values).
export const SCARD_S_SUCCESS = 0;
export const SCARD_E_NO_SERVICE = 0x8010001d;
export const SCARD_E_SERVICE_STOPPED = 0x8010001e;
export const SCARD_E_NO_READERS_AVAILABLE = 0x8010002e;
export const SCARD_W_RESET_CARD = 0x80100068;
export const SCARD_W_REMOVED_CARD = 0x80100069;

const SCARD_SCOPE_USER = 0;
const SCARD_SHARE_SHARED = 2;
const SCARD_PROTOCOL_T0 = 1;
const SCARD_PROTOCOL_T1 = 2;
const SCARD_LEAVE_CARD = 0;

/** Longest response to an extended-length APDU: 65536 data bytes plus the status word. */
const MAX_RESPONSE = 65538;

export class PcscError extends Error {
  readonly code: number;
  constructor(call: string, code: number) {
    super(`${call} failed (0x${code.toString(16).padStart(8, '0')})`);
    this.code = code;
  }
}

export interface Card {
  reader: string;
  atr: Uint8Array;
  /** Sends one command APDU and returns the card's response. */
  transmit(apdu: Uint8Array): Uint8Array;
  /** Keeps other programs on this computer from talking to the card in between our commands. */
  beginTransaction(): void;
  endTransaction(): void;
  /** Reconnects after another program reset the card. */
  reconnect(): void;
  disconnect(): void;
}

export interface Pcsc {
  /** Names of the connected readers; none when there are no readers (or no smart card service yet). */
  readers(): string[];
  /** Connects to the card in the reader, shared with other programs. Throws PcscError (e.g. no card). */
  connect(reader: string): Card;
  close(): void;
}

export function openPcsc(): Pcsc {
  const abi = ABIS[process.platform];
  if (!abi) throw new Error(`Smart cards aren't supported on ${process.platform}.`);
  const { dword, handle, result, suffix, names: encoding } = abi;
  const lib = dlopen(abi.library, {
    SCardEstablishContext: { args: [dword, 'ptr', 'ptr', 'ptr'], returns: result },
    SCardReleaseContext: { args: [handle], returns: result },
    [`SCardListReaders${suffix}`]: { args: [handle, 'ptr', 'ptr', 'ptr'], returns: result },
    [`SCardConnect${suffix}`]: { args: [handle, 'ptr', dword, dword, 'ptr', 'ptr'], returns: result },
    SCardReconnect: { args: [handle, dword, dword, dword, 'ptr'], returns: result },
    SCardDisconnect: { args: [handle, dword], returns: result },
    [`SCardStatus${suffix}`]: { args: [handle, 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'], returns: result },
    SCardBeginTransaction: { args: [handle], returns: result },
    SCardEndTransaction: { args: [handle, dword], returns: result },
    SCardTransmit: { args: [handle, 'ptr', 'ptr', dword, 'ptr', 'ptr', 'ptr'], returns: result },
  });
  const fn = (name: string) => {
    const symbol = lib.symbols[name];
    if (!symbol) throw new Error(`${abi.library} has no ${name}`);
    return symbol;
  };

  const dwordBytes = dword === 'u64' ? 8 : 4;
  /** An integer argument passed by value, as the FFI type expects it. */
  const word = (value: number) => (dword === 'u64' ? BigInt(value) : value);
  /** An out (or in-out) parameter of the given width. */
  const out = (bytes: number, value = 0) => {
    const cell = new Uint8Array(8);
    new DataView(cell.buffer).setBigUint64(0, BigInt(value), true);
    return { cell, read: () => readUnsigned(cell, bytes) };
  };
  const readHandle = (cell: Uint8Array): number | bigint => {
    const view = new DataView(cell.buffer);
    if (handle === 'i32') return view.getInt32(0, true);
    return handle === 'i64' ? view.getBigInt64(0, true) : view.getBigUint64(0, true);
  };
  const check = (call: string, rv: number | bigint) => {
    const code = Number(BigInt.asUintN(32, BigInt(rv)));
    if (code !== SCARD_S_SUCCESS) throw new PcscError(call, code);
  };

  const contextCell = new Uint8Array(8);
  check('SCardEstablishContext', fn('SCardEstablishContext')(word(SCARD_SCOPE_USER), null, null, contextCell));
  const context = readHandle(contextCell);

  return {
    readers() {
      const length = out(dwordBytes, 16 * 1024);
      const names = new Uint8Array(16 * 1024);
      try {
        check('SCardListReaders', fn(`SCardListReaders${suffix}`)(context, null, names, length.cell));
      } catch (error) {
        const code = error instanceof PcscError ? error.code : 0;
        if ([SCARD_E_NO_READERS_AVAILABLE, SCARD_E_NO_SERVICE, SCARD_E_SERVICE_STOPPED].includes(code)) return [];
        throw error;
      }
      return splitMultiString(names.subarray(0, length.read()), encoding);
    },

    connect(reader) {
      const cardCell = new Uint8Array(8);
      const protocol = out(dwordBytes);
      const name = Buffer.from(`${reader}\0`, encoding);
      const share = word(SCARD_SHARE_SHARED);
      const protocols = word(SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1);
      check('SCardConnect', fn(`SCardConnect${suffix}`)(context, name, share, protocols, cardCell, protocol.cell));
      const card = readHandle(cardCell);
      let active = protocol.read();

      const atr = new Uint8Array(64);
      const atrLength = out(dwordBytes, atr.length);
      const readerName = new Uint8Array(1024);
      const readerLength = out(dwordBytes, readerName.length);
      const state = out(dwordBytes);
      const statusProtocol = out(dwordBytes);
      try {
        check('SCardStatus', fn(`SCardStatus${suffix}`)(card, readerName, readerLength.cell, state.cell, statusProtocol.cell, atr, atrLength.cell));
      } catch (error) {
        fn('SCardDisconnect')(card, word(SCARD_LEAVE_CARD));
        throw error;
      }

      const response = new Uint8Array(MAX_RESPONSE);
      return {
        reader,
        atr: atr.slice(0, atrLength.read()),
        transmit(apdu) {
          // SCARD_IO_REQUEST: the protocol, then the struct's own size, both DWORDs.
          const pci = new Uint8Array(2 * dwordBytes);
          writeUnsigned(pci, 0, dwordBytes, active);
          writeUnsigned(pci, dwordBytes, dwordBytes, pci.length);
          const length = out(dwordBytes, response.length);
          check('SCardTransmit', fn('SCardTransmit')(card, pci, apdu, word(apdu.length), null, response, length.cell));
          return response.slice(0, length.read());
        },
        beginTransaction: () => check('SCardBeginTransaction', fn('SCardBeginTransaction')(card)),
        endTransaction: () => check('SCardEndTransaction', fn('SCardEndTransaction')(card, word(SCARD_LEAVE_CARD))),
        reconnect() {
          const reconnected = out(dwordBytes);
          check('SCardReconnect', fn('SCardReconnect')(card, share, protocols, word(SCARD_LEAVE_CARD), reconnected.cell));
          active = reconnected.read();
        },
        disconnect: () => void fn('SCardDisconnect')(card, word(SCARD_LEAVE_CARD)),
      };
    },

    close() {
      fn('SCardReleaseContext')(context);
      lib.close();
    },
  };
}

function readUnsigned(bytes: Uint8Array, width: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return width === 8 ? Number(view.getBigUint64(0, true)) : view.getUint32(0, true);
}

function writeUnsigned(bytes: Uint8Array, offset: number, width: number, value: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  if (width === 8) view.setBigUint64(offset, BigInt(value), true);
  else view.setUint32(offset, value, true);
}

/** PC/SC lists readers as one string: names separated by NUL, ending with an extra NUL. */
export function splitMultiString(bytes: Uint8Array, encoding: 'latin1' | 'utf8'): string[] {
  return Buffer.from(bytes).toString(encoding).split('\0').filter(Boolean);
}
