import { newVpn } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { setupProblem } from './connection.ts';
import { formErrors } from './form-errors.ts';

const openvpn = newVpn('openvpn', { id: 'a', name: 'A' });

describe("an imported file's errors", () => {
  it("asks for the file when it's missing", () => {
    expect(formErrors(openvpn, [], [], {})['secrets.profile']).toBe(
      'Choose the .ovpn profile from your provider.',
    );
    expect(setupProblem(openvpn, [])).toBe('Finish setting up');
    expect(setupProblem({ ...openvpn, remotes: ['vpn.example.com'] }, [])).toBe(
      'Needs the .ovpn profile',
    );
  });

  it("shows errors of the settings read from it on the file's field", () => {
    const errors = formErrors(openvpn, [], ['profile'], {});
    expect(errors['secrets.profile']).toBe(errors.remotes);
    expect(errors.remotes).toBeDefined();
  });
});
