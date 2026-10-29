import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { VPCD_PORT, VPCD_RELAY_SOURCE } from '@repo/vpn-sdk/container';
import type { Docker } from './docker.ts';
import { openCardBridge } from './smart-card.ts';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn<typeof spawn>(),
}));

async function card() {
  const process = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn<ChildProcess['kill']>(() => true),
  });
  vi.mocked(spawn).mockReturnValueOnce(process);
  const pending = openCardBridge('/card-bridge', {
    idCardOnly: true,
    signal: new AbortController().signal,
    onWaiting: () => {},
    onLog: () => {},
  });
  process.stderr.write('MVPN-CARD:Reader\n');
  const bridge = await pending;
  const relay = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn<ChildProcess['kill']>(() => true),
  });
  const docker = { pipe: vi.fn<Docker['pipe']>(() => relay) };
  return { process, bridge, relay, docker };
}

it('attaches through Docker and reports card removal once, stopping the relay', async () => {
  const c = await card();
  const failed = vi.fn<(message: string) => void>();
  c.bridge.attach(c.docker, 'mvpn-test', failed);
  expect(c.docker.pipe).toHaveBeenCalledWith(
    [
      'exec',
      '-i',
      'mvpn-test',
      'socat',
      'STDIO',
      `TCP:127.0.0.1:${VPCD_PORT},bind=${VPCD_RELAY_SOURCE},retry=120,interval=0.25`,
    ],
    c.process.stdout,
    c.process.stdin,
  );
  c.process.stderr.write('MVPN-ERROR:The card was removed.\n');
  c.process.emit('close');
  c.relay.emit('close');
  expect(failed).toHaveBeenCalledExactlyOnceWith('The card was removed.');
  expect(c.relay.kill).toHaveBeenCalledOnce();
});

it('reports a card removed before attach without starting a relay', async () => {
  const c = await card();
  c.process.emit('close');
  const failed = vi.fn<(message: string) => void>();
  c.bridge.attach(c.docker, 'mvpn-test', failed);
  expect(failed).toHaveBeenCalledExactlyOnceWith('The card bridge stopped.');
  expect(c.docker.pipe).not.toHaveBeenCalled();
});

it('stops both processes without reporting an intentional stop as failure', async () => {
  const c = await card();
  const failed = vi.fn<(message: string) => void>();
  c.bridge.attach(c.docker, 'mvpn-test', failed);
  c.bridge.stop();
  c.relay.emit('close');
  c.process.emit('close');
  expect(c.process.kill).toHaveBeenCalledOnce();
  expect(c.relay.kill).toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});
