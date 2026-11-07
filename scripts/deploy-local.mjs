#!/usr/bin/env node
// Install the exact Media process/UI artifacts from this checkout's release dir
// onto the existing local Delta node. Library data stays in the app origin's
// IndexedDB; the UI replacement only touches DATA_DIR/apps/dev.delta.media.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, cp, chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const appManifest = JSON.parse(await readFile(join(root, 'app.manifest.json'), 'utf8'));
const expectedVersion = packageInfo.version;
if (packageInfo.name !== 'delta-media' || appManifest.id !== 'dev.delta.media' || appManifest.version !== expectedVersion)
  throw Error('Media source manifests do not agree on identity and version.');

const release = join(root, 'release');
const processAsset = join(release, 'delta-media.tar.gz');
const uiAsset = join(release, 'delta-media.delta-app');
const sums = await readFile(join(release, 'SHA256SUMS'), 'utf8');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function expectedDigest(file) {
  const row = sums.split(/\r?\n/).find(line => line.trim().endsWith(`  ${file}`));
  if (!row || !/^[a-f0-9]{64}  /.test(row)) throw Error(`Missing checksum for ${file}.`);
  return row.slice(0, 64);
}
const processBytes = await readFile(processAsset);
const uiBytes = await readFile(uiAsset);
const processSha = digest(processBytes);
const uiSha = digest(uiBytes);
if (processSha !== expectedDigest('delta-media.tar.gz') || uiSha !== expectedDigest('delta-media.delta-app'))
  throw Error('Release artifact checksum mismatch. Rebuild the package before deployment.');

let processManifest;
try {
  processManifest = JSON.parse(execFileSync('tar', ['-xOzf', processAsset, './manifest.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  throw Error('Cannot read the process manifest from delta-media.tar.gz.');
}
const uiPackage = JSON.parse(uiBytes.toString('utf8'));
if (processManifest.id !== 'media' || processManifest.version !== expectedVersion ||
    processManifest.metadata?.ui?.id !== 'dev.delta.media' ||
    uiPackage.format !== 'delta-app-v1' || uiPackage.manifest?.id !== 'dev.delta.media' ||
    uiPackage.manifest?.version !== expectedVersion)
  throw Error('Release process and UI artifacts are not the same Media version.');

const require = createRequire(import.meta.url);
const uiPackageRoot = dirname(require.resolve('@delta/ui/package.json'));
const runtime = await import(pathToFileURL(join(uiPackageRoot, 'scripts/app-runtime.mjs')));
const verifiedUi = runtime.verify(uiBytes, { id: 'dev.delta.media', version: expectedVersion, sha256: uiSha });

const home = resolve(process.env.DELTA_HOME || join(homedir(), '.delta'));
const args = process.argv.slice(2);
const uiOnly = args.length === 1 && args[0] === '--ui-only';
if (args.length > 1 || (args.length === 1 && !uiOnly)) throw Error('Usage: node scripts/deploy-local.mjs [--ui-only]');
const config = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'));
const token = (await readFile(join(home, 'admin.token'), 'utf8')).trim();
if (!token || !Number.isInteger(config.port) || !config.node_id) throw Error('Existing local Delta owner setup is incomplete.');
const web = (config.components || []).find(component => component.id === 'web');
if (!web) throw Error('The local Delta Web plugin is not configured.');
const webEnv = web.env || {};
const webDataValue = webEnv.DATA_DIR || webEnv.DELTA_DATA || join(home, 'data', 'web');
const webData = isAbsolute(webDataValue) ? resolve(webDataValue) : resolve(home, webDataValue);
const appsRoot = join(webData, 'apps');
const appDirectory = join(appsRoot, 'dev.delta.media');
const webPort = Number(webEnv.PORT || 7710);
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) throw Error('Invalid configured Web port.');
const coreUrl = `http://127.0.0.1:${config.port}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const webOrigin = webEnv.PUBLIC_ORIGIN || webUrl;
const coreCall = async (capability, callArgs = {}) => {
  const response = await fetch(`${coreUrl}/v1/call`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(190000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ capability, args: callArgs }),
  });
  let body;
  try { body = await response.json(); } catch { throw Error(`Delta Core returned an invalid response for ${capability}.`); }
  if (!response.ok || !body.ok) throw Error(`Delta Core rejected ${capability}; deployment stopped.`);
  return body.result;
};
const webRequest = async (method, path, body) => {
  const response = await fetch(`${webUrl}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(190000),
    headers: { authorization: `Bearer ${token}`, origin: webOrigin, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw Error(`Delta Web rejected ${path}; deployment stopped.`);
  return response.json();
};

if (!uiOnly) {
  const info = await coreCall('core.info');
  if (info.node_id !== config.node_id) throw Error('The running Delta node does not match this Delta home.');
  await coreCall('identity.list');
  const existingComponents = await coreCall('core.components');
  if (!existingComponents.some(component => component.id === 'media')) throw Error('Delta Media is not installed on this node.');
  const catalog = await coreCall('packages.catalog');
  const entry = catalog.plugins?.find(item => item.id === 'dev.delta.media' && item.component === 'media');
  if (!entry || entry.version !== expectedVersion || entry.sha256 !== processSha)
    throw Error(`The official Core catalog must advertise Media ${expectedVersion} with the artifact checksum before process deployment.`);
  const plan = await coreCall('packages.plan', { id: 'dev.delta.media' });
  if (!plan.items?.some(item => item.id === 'dev.delta.media' && item.component === 'media') ||
      plan.items.some(item => item.id !== 'dev.delta.media' && !existingComponents.some(current => current.id === item.component)))
    throw Error('The Media update plan includes an uninstalled executable dependency. Review it before updating.');

  const job = await coreCall('packages.install', { id: 'dev.delta.media', expectedVersion, expectedSha256: processSha });
  let completed = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    await new Promise(resolveTimer => setTimeout(resolveTimer, 1000));
    const state = (await coreCall('packages.jobs')).find(item => item.id === job.jobId);
    if (state?.status === 'failed') throw Error('Delta Media process installation failed; inspect Delta package jobs.');
    if (state?.status === 'complete') { completed = true; break; }
  }
  if (!completed) throw Error('Delta Media process update is still running; inspect Delta package jobs before retrying.');
  const installedComponents = await coreCall('core.components');
  if (!installedComponents.some(component => component.id === 'media' && component.version === expectedVersion))
    throw Error('Delta Core did not report the expected Media process version after installation.');
}

const installedApps = await webRequest('GET', '/apps/list');
const currentApp = installedApps.find(item => item.id === 'dev.delta.media');
if (!currentApp) throw Error('Delta Media is not installed in this Web host.');
await mkdir(appsRoot, { recursive: true, mode: 0o700 });
let backup = null;
try {
  const currentStat = await lstat(appDirectory);
  if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) throw Error('The installed Media app path is not a regular directory.');
  const currentManifest = JSON.parse(await readFile(join(appDirectory, '.delta-manifest.json'), 'utf8'));
  const sameAssets = currentManifest.version === expectedVersion && (await Promise.all(verifiedUi.files.map(async file => {
    try { return digest(await readFile(join(appDirectory, file.path))) === digest(file.bytes); } catch { return false; }
  }))).every(Boolean);
  if (sameAssets) {
    console.log(uiOnly ? `Delta Media UI ${expectedVersion} already matches the release artifact.` : `Delta Media ${expectedVersion}: process and UI already match the release artifacts.`);
    process.exit(0);
  }
  const backupRoot = join(home, 'backups');
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(backupRoot, 0o700);
  backup = join(backupRoot, `media-ui-${currentManifest.version}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
  await mkdir(backup, { mode: 0o700 });
  await cp(appDirectory, join(backup, 'dev.delta.media'), { recursive: true, preserveTimestamps: true });
  const backupAsset = join(backup, 'delta-media.delta-app');
  await copyFile(uiAsset, backupAsset);
  if (process.platform !== 'win32') {
    await chmod(backup, 0o700);
    await chmod(backupAsset, 0o600);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

try {
  await runtime.install(appsRoot, uiBytes, { id: 'dev.delta.media', version: expectedVersion, sha256: uiSha }, { replace: true });
  const installedManifest = JSON.parse(await readFile(join(appDirectory, '.delta-manifest.json'), 'utf8'));
  if (installedManifest.id !== 'dev.delta.media' || installedManifest.version !== expectedVersion)
    throw Error('Installed UI manifest did not match the release.');
} catch (error) {
  if (backup) {
    await rm(appDirectory, { recursive: true, force: true });
    await cp(join(backup, 'dev.delta.media'), appDirectory, { recursive: true, preserveTimestamps: true });
  }
  throw error;
}

const appUrl = webEnv.APP_PUBLIC_ORIGIN
  ? webEnv.APP_PUBLIC_ORIGIN.replace('{app}', 'deltaapp-dev-delta-media')
  : 'http://deltaapp-dev-delta-media.localhost:7711';
console.log(uiOnly ? `Installed Delta Media UI ${expectedVersion}.` : `Installed Delta Media ${expectedVersion} (process + UI).`);
if (backup) console.log(`Previous UI backed up to ${backup}`);
console.log(`Media app origin: ${appUrl}`);
console.log('Reload an already open Media tab to load the new UI.');
