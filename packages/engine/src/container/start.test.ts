import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markers, NONCE_FILE } from '@repo/vpn-sdk/container';
import { LAUNCHERS } from '@repo/vpns/engine';
import { newVpn } from '@repo/vpns';
import type { Docker } from '../docker.ts';
import { createVpnNetwork, dnsFlags, startVpnContainer, type StartOptions } from './start.ts';

class Output extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn<() => void>(() => {
    this.stdout.end();
    this.stderr.end();
    this.emit('close');
  });
}

/** Runs the real start and output reader, with only Docker commands scripted in memory. */
async function connecting(overrides: Partial<StartOptions> = {}) {
  const output = new Output();
  let nonce = '';
  let followed!: () => void;
  const following = new Promise<void>((resolve) => {
    followed = resolve;
  });
  const run = vi.fn<Docker['run']>(async () => ({ code: 0, stdout: '', stderr: '' }));
  const runChecked = vi.fn<Docker['runChecked']>(async (args) => {
    if (args[0] === 'cp') {
      nonce = await readFile(join(args[1]!.slice(0, -2), NONCE_FILE), 'utf8');
    }
    return args[0] === 'port' ? '127.0.0.1:43210' : '';
  });
  const docker: Docker = {
    run,
    runChecked,
    assertRunning: async () => {},
    followLogs: () => {
      followed();
      return output;
    },
    pipe: () => {
      throw new Error('Unexpected card relay');
    },
  };
  const controller = new AbortController();
  const launch = await LAUNCHERS.checkpoint.launch(
    newVpn('checkpoint', { id: 'test', name: 'Test' }),
    { read: async () => undefined, loginPassword: async () => 'password' },
  );
  if (launch === 'needs-password') {
    throw new Error('Expected a launch');
  }
  const options: StartOptions = {
    vpnId: 'test',
    dnsServers: [],
    signal: controller.signal,
    launch,
    onPrompt: vi.fn<StartOptions['onPrompt']>(async () => '123456'),
    onBrowserSignIn: vi.fn<StartOptions['onBrowserSignIn']>(async () => 'token'),
    onLog: vi.fn<StartOptions['onLog']>(),
    onExit: vi.fn<StartOptions['onExit']>(),
    ...overrides,
  };
  const result = startVpnContainer(docker, options);
  // Attach a rejection handler before tests advance timers or terminate the stream.
  void result.catch(() => {});
  await Promise.race([following, result]);
  await Promise.resolve();
  return { output, docker, options, controller, result, marker: markers(nonce) };
}

afterEach(() => {
  vi.useRealTimers();
});

it('answers an SMS prompt, ignores foreign markers, and connects only on its own ready marker', async () => {
  const c = await connecting({
    onPrompt: vi.fn<StartOptions['onPrompt']>(async () => '12\n34\x03'),
  });
  let connected = false;
  void c.result.then(() => {
    connected = true;
  });
  c.output.stdout.write(markers('foreign').ready + '\n');
  c.output.stderr.write(c.marker.prompt + ' SMS code\n');
  await vi.waitFor(() =>
    expect(c.docker.runChecked).toHaveBeenCalledWith(
      ['exec', '-i', 'mvpn-test', 'sh', '-c', 'cat > /run/mvpn/answers'],
      '1234\n',
    ),
  );
  expect(connected).toBe(false);
  c.output.stdout.write(c.marker.ready + '\n');
  const session = await c.result;
  expect(session.port).toBe(43_210);
  await session.stop();
  expect(c.output.kill).toHaveBeenCalledOnce();
  expect(c.options.onExit).not.toHaveBeenCalled();
  expect(c.docker.run).toHaveBeenLastCalledWith(['network', 'rm', 'mvpn-test']);
});

it('pauses the timeout while waiting for input and grants a fresh timeout after delivery', async () => {
  let reply!: (value: string) => void;
  const c = await connecting({
    onPrompt: () =>
      new Promise<string>((resolve) => {
        reply = resolve;
      }),
  });
  vi.useFakeTimers();
  // The initial timer was installed before fake timers; a prompt clears it.
  c.output.stdout.write(c.marker.prompt + ' SMS\n');
  await vi.advanceTimersByTimeAsync(180_000);
  expect(c.output.kill).not.toHaveBeenCalled();
  reply('123');
  await vi.advanceTimersByTimeAsync(89_999);
  expect(c.output.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(c.result).rejects.toThrow("didn't connect within 90 seconds");
  expect(c.output.kill).toHaveBeenCalledOnce();
});

it('times out without receiving output', async () => {
  vi.useFakeTimers();
  const c = await connecting();
  await vi.advanceTimersByTimeAsync(90_000);
  await expect(c.result).rejects.toThrow("didn't connect within 90 seconds");
  expect(c.output.kill).toHaveBeenCalledOnce();
});

it('reports the last output when the log process closes before success', async () => {
  const c = await connecting();
  c.output.stderr.write('gateway disconnected\n');
  c.output.emit('close');
  await expect(c.result).rejects.toThrow('stopped before connecting: gateway disconnected');
  expect(c.docker.run).toHaveBeenLastCalledWith(['network', 'rm', 'mvpn-test']);
});

it('cleans up when the log process cannot start', async () => {
  const c = await connecting();
  c.output.emit('error', new Error('spawn failed'));
  await expect(c.result).rejects.toThrow('spawn failed');
  expect(c.output.kill).toHaveBeenCalledOnce();
});

it('aborts an active connection attempt and stops its card bridge', async () => {
  const cardBridge = {
    reader: 'test',
    attach: vi.fn<NonNullable<StartOptions['cardBridge']>['attach']>(),
    stop: vi.fn<() => void>(),
  };
  const c = await connecting({ cardBridge });
  c.controller.abort(new Error('Cancelled connect'));
  await expect(c.result).rejects.toThrow('Cancelled connect');
  expect(c.output.kill).toHaveBeenCalledOnce();
  expect(cardBridge.stop).toHaveBeenCalledOnce();
});

it('fails when the smart card is removed during connection', async () => {
  let removed!: (message: string) => void;
  const cardBridge = {
    reader: 'test',
    stop: vi.fn<() => void>(),
    attach: (_docker: Pick<Docker, 'pipe'>, _name: string, fail: (message: string) => void) => {
      removed = fail;
    },
  };
  const c = await connecting({ cardBridge });
  removed('The card was removed.');
  await expect(c.result).rejects.toThrow('The card was removed.');
  expect(cardBridge.stop).toHaveBeenCalledOnce();
});

it('delivers a real Check Point browser-login request and token before success', async () => {
  const c = await connecting();
  c.output.stdout.write(
    'For identity provider authentication, open the following URL in your browser:\n',
  );
  c.output.stdout.write('https://vpn.example.com/saml-vpn/spPortal/ACS/Login/EntraID?token=abc\n');
  await vi.waitFor(() =>
    expect(c.options.onBrowserSignIn).toHaveBeenCalledWith({
      signInUrl: 'https://vpn.example.com/saml-vpn/spPortal/ACS/Login/EntraID?token=abc',
      tokenPort: 7779,
    }),
  );
  expect(c.docker.runChecked).toHaveBeenCalledWith(
    [
      'exec',
      '-i',
      'mvpn-test',
      'curl',
      '-fsS',
      '--max-time',
      '10',
      '-o',
      '/dev/null',
      '--config',
      '-',
    ],
    'url = "http://127.0.0.1:7779/token"\n',
  );
  c.output.stdout.write(c.marker.ready + '\n');
  const session = await c.result;
  c.output.emit('close');
  expect(c.options.onExit).toHaveBeenCalledOnce();
  await session.stop();
});

describe('dnsFlags', () => {
  it("uses the VPN's configured DNS servers", () => {
    expect(dnsFlags(['10.0.0.53'])).toEqual(['--dns', '10.0.0.53']);
  });

  it("never falls back to Docker's resolver, which would resolve routed domains to placeholders", () => {
    expect(dnsFlags([])).toEqual(['--dns', '1.1.1.1', '--dns', '9.9.9.9']);
  });
});

describe('createVpnNetwork', () => {
  /** A Docker whose `network create` answers from `answers`, one per call, recording each subnet asked for. */
  const docker = (...answers: { code: number; stderr: string }[]) => {
    const subnets: string[] = [];
    return {
      subnets,
      run: async (args: readonly string[]) => {
        subnets.push(args[args.indexOf('--subnet') + 1] ?? '');
        return { stdout: '', ...(answers.shift() ?? { code: 0, stderr: '' }) };
      },
    };
  };
  const overlap = {
    code: 1,
    stderr:
      'Error response from daemon: invalid pool request: Pool overlaps with other one on this address space',
  };

  it('gives each VPN a small network of its own in the reserved block, skipping ranges another network holds', async () => {
    const fake = docker(overlap, overlap);
    await createVpnNetwork(fake, 'mvpn-a');
    expect(fake.subnets).toEqual(['198.18.128.0/28', '198.18.128.16/28', '198.18.128.32/28']);
  });

  it('gives up on any other error, and when every range is taken', async () => {
    await expect(
      createVpnNetwork(docker({ code: 1, stderr: 'permission denied' }), 'mvpn-a'),
    ).rejects.toThrow('permission denied');
    const full = docker(...Array.from({ length: 64 }, () => overlap));
    await expect(createVpnNetwork(full, 'mvpn-a')).rejects.toThrow('no free network');
    expect(full.subnets.at(-1)).toBe('198.18.131.240/28');
  });
});

it('rejects a real client authentication failure and removes the container', async () => {
  const c = await connecting();
  c.output.stderr.write('Error: Authentication failed\n');
  await expect(c.result).rejects.toThrow('The VPN server rejected the sign-in');
  expect(c.output.kill).toHaveBeenCalledOnce();
});

it('cleans up when the user cancels an SMS prompt', async () => {
  const c = await connecting({
    onPrompt: async () => {
      throw new Error('Prompt cancelled');
    },
  });
  c.output.stdout.write(c.marker.prompt + ' SMS\n');
  await expect(c.result).rejects.toThrow('Prompt cancelled');
  expect(c.output.kill).toHaveBeenCalledOnce();
});
