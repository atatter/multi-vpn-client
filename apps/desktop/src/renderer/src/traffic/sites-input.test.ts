import { newRoute } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { addEntries } from './sites-input.ts';

describe('typing sites', () => {
  it('adds several sites and ranges at once, separated by spaces or commas', () => {
    const result = addEntries('jira.example.com, 10.20.0.0/16 wiki.example.com', [], 'b');
    expect(
      result.routes.map((route) => (route.kind === 'cidr' ? route.cidr : route.domain)),
    ).toEqual(['jira.example.com', '10.20.0.0/16', 'wiki.example.com']);
    expect(result).toMatchObject({ text: '', problem: undefined });
  });

  it("keeps what isn't a site in the box, and says why", () => {
    const result = addEntries('jira.example.com 10.0.0.0/99 bad$host', [], 'b');
    expect(result.routes).toHaveLength(1);
    expect(result.text).toBe('10.0.0.0/99 bad$host');
    expect(result.problem).toBe("10.0.0.0/99 and bad$host aren't sites or IP ranges.");
  });

  it("doesn't add a site twice", () => {
    const existing = [newRoute('10.20.0.0/16', 'b')];
    expect(addEntries('10.20.0.0/16', existing, 'b')).toMatchObject({
      routes: existing,
      problem: '10.20.0.0/16 is already in the list.',
    });
  });
});
