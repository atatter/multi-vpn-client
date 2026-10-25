import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { implement } from './engine.ts';

const context = { runInImage: async () => ({ code: 0, stdout: '', stderr: '' }) };

describe('implement', () => {
  const actions = implement(
    { double: { input: z.number(), output: z.number() } },
    { double: async (value) => value * 2 },
  );

  it('runs an action with its parsed input', async () => {
    expect(await actions.double?.(2, context)).toBe(4);
  });

  it("refuses input the action didn't declare, before running it", async () => {
    await expect(actions.double?.('2', context)).rejects.toThrow(z.ZodError);
  });
});
