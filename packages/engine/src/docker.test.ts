import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { createDocker } from './docker.ts';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn<typeof spawn>(),
}));

it('follows both Docker log streams and exposes process cleanup', () => {
  const child = Object.assign(new ChildProcess(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn<ChildProcess['kill']>(() => true),
  });
  // Only the child-process implementation is replaced; callers receive the real streams.
  vi.mocked(spawn).mockReturnValueOnce(child);
  const logs = createDocker('/docker').followLogs('mvpn-test');
  expect(spawn).toHaveBeenLastCalledWith('/docker', ['logs', '--follow', 'mvpn-test'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(logs.stdout).toBe(child.stdout);
  expect(logs.stderr).toBe(child.stderr);
  logs.kill();
  expect(child.kill).toHaveBeenCalledOnce();
});

it('pipes binary card traffic in both directions and tolerates a closed stdin', () => {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn<ChildProcess['kill']>(() => true),
  });
  vi.mocked(spawn).mockReturnValueOnce(child);
  const source = new PassThrough();
  const destination = new PassThrough();
  const sent: Buffer[] = [];
  const received: Buffer[] = [];
  child.stdin.on('data', (data: Buffer) => sent.push(data));
  destination.on('data', (data: Buffer) => received.push(data));
  const relay = createDocker('/docker').pipe(
    ['exec', '-i', 'mvpn-test', 'socat'],
    source,
    destination,
  );
  source.write(Buffer.from([0, 255, 10]));
  child.stdout.write(Buffer.from([255, 0]));
  expect(Buffer.concat(sent)).toEqual(Buffer.from([0, 255, 10]));
  expect(Buffer.concat(received)).toEqual(Buffer.from([255, 0]));
  expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow();
  expect(relay).toBe(child);
  source.end();
  child.stdout.end();
});
