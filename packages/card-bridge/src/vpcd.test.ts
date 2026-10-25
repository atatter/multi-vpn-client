import { describe, expect, it } from 'vitest';
import { createFramer, frame, ID_CARD_GUARDED_PINS, refusal } from './vpcd.ts';

describe('vpcd framing', () => {
  it('splits messages however the stream is chunked', () => {
    const messages: number[][] = [];
    const feed = createFramer((message) => messages.push([...message]));
    const stream = Uint8Array.of(
      ...frame(Uint8Array.of(4)),
      ...frame(Uint8Array.of(0x00, 0xa4, 0x04, 0x00)),
      ...frame(new Uint8Array(0)),
    );
    for (const byte of stream) feed(Uint8Array.of(byte));
    expect(messages).toEqual([[4], [0x00, 0xa4, 0x04, 0x00], []]);

    messages.length = 0;
    feed(stream);
    expect(messages).toHaveLength(3);
  });

  it('frames with a big-endian length', () => {
    expect([...frame(new Uint8Array(0x0102))].slice(0, 2)).toEqual([0x01, 0x02]);
    expect(() => frame(new Uint8Array(0x10000))).toThrow(RangeError);
  });

  it('refuses changing, turning off or unblocking PINs, in either instruction form, and passes everything else on', () => {
    for (const instruction of [0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2c, 0x2d]) {
      expect(refusal(Uint8Array.of(0x00, instruction, 0x00, 0x01))).toEqual(
        Uint8Array.of(0x6d, 0x00),
      );
    }
    expect(
      refusal(Uint8Array.of(0x00, 0x20, 0x00, 0x01, 0x04, 0x31, 0x32, 0x33, 0x34), [0x85, 0x02]),
    ).toBeUndefined();
    expect(refusal(Uint8Array.of(0x00, 0x88, 0x00, 0x00), [0x85, 0x02])).toBeUndefined();
    expect(refusal(Uint8Array.of(0x00, 0x20, 0x00))).toEqual(Uint8Array.of(0x67, 0x00));
  });

  it("refuses an Estonian ID card's PIN2 and PUK, which signing in never needs, on every card generation", () => {
    const verify = (instruction: number, reference: number) =>
      Uint8Array.of(0x00, instruction, 0x00, reference, 0x05, 0x31, 0x32, 0x33, 0x34, 0x35);
    expect([...ID_CARD_GUARDED_PINS.values()]).toEqual([
      [0x85, 0x02],
      [0x85, 0x02],
      [0x82, 0x83],
    ]);
    for (const guarded of ID_CARD_GUARDED_PINS.values()) {
      for (const pin of guarded) {
        expect(refusal(verify(0x20, pin), guarded)).toEqual(Uint8Array.of(0x69, 0x82));
        expect(refusal(verify(0x21, pin), guarded)).toEqual(Uint8Array.of(0x69, 0x82));
        expect(refusal(verify(0x20, pin ^ 0x80), guarded)).toEqual(Uint8Array.of(0x69, 0x82));
      }
    }
    // PIN1 (0x01, or 0x81 on the 2025 card) still passes, and so does anything on another card.
    expect(refusal(verify(0x20, 0x01), [0x85, 0x02])).toBeUndefined();
    expect(refusal(verify(0x20, 0x81), [0x82, 0x83])).toBeUndefined();
    expect(refusal(verify(0x20, 0x85))).toBeUndefined();
  });
});
