import { APP_NAME } from '@repo/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Electron names the app after `productName`, and that name picks the OS keychain entry that encrypts saved
// secrets. Changing it makes every saved secret unreadable, so it's pinned to the visible name.
describe("the app's name", () => {
  it('is the product name users see, which also keys the saved secrets', () => {
    const pkg: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg).toMatchObject({ productName: APP_NAME });
  });
});
