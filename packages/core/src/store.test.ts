import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import type { Config } from './config.ts';
import { newVpn } from '@repo/vpns';
import { appDir, defaultConfigPath, desktopEntryFiles, loadConfig, moveAppDir, saveConfig } from './store.ts';

const tempFile = async () => join(await mkdtemp(join(tmpdir(), 'mvpn-')), 'nested', 'config.json');

const config: Config = {
  version: 1,
  vpns: [{ ...newVpn('checkpoint', { id: 'a', name: 'Client A' }), server: '203.0.113.10', loginType: 'vpn_Password' }],
  routes: [{ id: 'r1', kind: 'cidr', cidr: '10.20.0.0/16', vpnId: 'a', enabled: true, note: '', pinned: false }],
  priority: ['a'],
};

describe('store', () => {
  it('returns the empty config when no file exists', async () => {
    expect(await loadConfig(await tempFile())).toEqual({ version: 1, vpns: [], routes: [], priority: [] });
  });

  it('round-trips a config, creating the directory', async () => {
    const path = await tempFile();
    await saveConfig(config, path);
    expect(await loadConfig(path)).toEqual(config);
  });

  it('refuses to save an invalid config and leaves the old file intact', async () => {
    const path = await tempFile();
    await saveConfig(config, path);
    const broken = { ...config, routes: [{ ...config.routes[0]!, cidr: '10.20.1.5/16' }] };
    await expect(saveConfig(broken, path)).rejects.toThrow('Host bits are set');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(config);
  });

  it('rejects a corrupted file on load', async () => {
    const path = await tempFile();
    await saveConfig(config, path);
    await writeFile(path, JSON.stringify({ version: 2 }));
    await expect(loadConfig(path)).rejects.toThrow(ZodError);
  });

  it('puts the config in the per-user app data folder', () => {
    expect(defaultConfigPath({ APPDATA: '/appdata' }, 'win32')).toBe(join('/appdata', 'Multi VPN Client', 'config.json'));
    expect(defaultConfigPath({ HOME: '/Users/a' }, 'darwin')).toBe(join('/Users/a', 'Library', 'Application Support', 'Multi VPN Client', 'config.json'));
    expect(defaultConfigPath({ XDG_CONFIG_HOME: '/x' }, 'linux')).toBe(join('/x', 'multi-vpn-client', 'config.json'));
    expect(defaultConfigPath({ MVPN_CONFIG: '/tmp/test.json', XDG_CONFIG_HOME: '/x' }, 'linux')).toBe('/tmp/test.json');
    // Empty or relative XDG/APPDATA values are ignored rather than producing a relative path.
    expect(defaultConfigPath({ XDG_CONFIG_HOME: '' }, 'linux')).toBe(join(homedir(), '.config', 'multi-vpn-client', 'config.json'));
    expect(defaultConfigPath({ XDG_CONFIG_HOME: 'relative' }, 'linux')).toBe(join(homedir(), '.config', 'multi-vpn-client', 'config.json'));
  });

  it('moves the old multi-vpn-client folder to the current name once, with everything in it', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'mvpn-appdata-'));
    const env = { APPDATA: appData };
    await mkdir(join(appData, 'multi-vpn-client'));
    await writeFile(join(appData, 'multi-vpn-client', 'helper.json'), '{}');
    // An empty folder in the way (an earlier start may have made it) doesn't stop the move.
    await mkdir(join(appData, 'Multi VPN Client'));
    moveAppDir(env, 'win32');
    expect(await readFile(join(appData, 'Multi VPN Client', 'helper.json'), 'utf8')).toBe('{}');
    expect(existsSync(join(appData, 'multi-vpn-client'))).toBe(false);
    expect(appDir(env, 'win32')).toBe(join(appData, 'Multi VPN Client'));
  });

  it("moves the old folder's files into a new folder that already holds something, overwriting nothing", async () => {
    const appData = await mkdtemp(join(tmpdir(), 'mvpn-appdata-'));
    const env = { APPDATA: appData };
    await mkdir(join(appData, 'multi-vpn-client'));
    await writeFile(join(appData, 'multi-vpn-client', 'config.json'), 'old config');
    await writeFile(join(appData, 'multi-vpn-client', 'Local State'), 'old state');
    await mkdir(join(appData, 'Multi VPN Client'));
    await writeFile(join(appData, 'Multi VPN Client', 'Local State'), 'new state');
    expect(moveAppDir(env, 'win32')).toBe(join(appData, 'Multi VPN Client'));
    expect(await readFile(join(appData, 'Multi VPN Client', 'config.json'), 'utf8')).toBe('old config');
    expect(await readFile(join(appData, 'Multi VPN Client', 'Local State'), 'utf8')).toBe('new state');
    // The clash stays behind rather than being deleted.
    expect(await readFile(join(appData, 'multi-vpn-client', 'Local State'), 'utf8')).toBe('old state');
  });

  it("keeps using the old folder while its config can't be moved, so the VPNs never look gone", async () => {
    const appData = await mkdtemp(join(tmpdir(), 'mvpn-appdata-'));
    const env = { APPDATA: appData };
    await mkdir(join(appData, 'multi-vpn-client'));
    await writeFile(join(appData, 'multi-vpn-client', 'config.json'), '{}');
    expect(appDir(env, 'win32')).toBe(join(appData, 'multi-vpn-client'));
    expect(defaultConfigPath(env, 'win32')).toBe(join(appData, 'multi-vpn-client', 'config.json'));
  });

  it("leaves Linux's folder where it is", async () => {
    const config = await mkdtemp(join(tmpdir(), 'mvpn-xdg-'));
    await mkdir(join(config, 'multi-vpn-client'));
    moveAppDir({ XDG_CONFIG_HOME: config }, 'linux');
    expect(appDir({ XDG_CONFIG_HOME: config }, 'linux')).toBe(join(config, 'multi-vpn-client'));
  });
});

describe('desktopEntryFiles', () => {
  it("are in XDG_DATA_HOME when it's an absolute path, and ~/.local/share otherwise", () => {
    expect(desktopEntryFiles({ XDG_DATA_HOME: '/data' }, '/home/ann').entry).toBe(join('/data', 'applications', 'dev.multi-vpn-client.desktop'));
    const share = join('/home/ann', '.local', 'share');
    expect(desktopEntryFiles({ XDG_DATA_HOME: 'relative' }, '/home/ann').icon).toBe(join(share, 'icons', 'hicolor', '512x512', 'apps', 'dev.multi-vpn-client.png'));
    expect(desktopEntryFiles({}, '/home/ann').entry).toBe(join(share, 'applications', 'dev.multi-vpn-client.desktop'));
  });
});
