import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as crypto from 'crypto';
import * as fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';

const releases = 'https://github.com/errata-ai/vale/releases/download';
const last = 'https://github.com/errata-ai/vale/releases/latest/';

function assertHttps(url: string, what: string): void {
  if (!url.startsWith('https://')) {
    throw new Error(
      `Refusing to download ${what} from a non-HTTPS URL: '${url}'`
    );
  }
}

async function verifyChecksum(
  archivePath: string,
  checksumsUrl: string,
  assetName: string
): Promise<void> {
  const response = await fetch(checksumsUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch checksums from '${checksumsUrl}': ${response.status} ${response.statusText}`
    );
  }

  const line = (await response.text())
    .split('\n')
    .find(l => l.trim().endsWith(assetName));
  if (!line) {
    throw new Error(
      `No checksum entry found for '${assetName}' in '${checksumsUrl}'`
    );
  }
  const expected = line.trim().split(/\s+/)[0];

  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(archivePath));
  const actual = hash.digest('hex');

  if (expected !== actual) {
    throw new Error(
      `Checksum mismatch for '${assetName}': expected ${expected}, got ${actual}`
    );
  }

  core.info(`Verified checksum for '${assetName}'.`);
}

async function lookupLint(): Promise<string> {
  let path = '';
  let stderr = '';

  let resp = await exec.exec('which', ['vale'], {
    listeners: {
      stdout: (buffer: Buffer) => (path = buffer.toString().trim()),
      stderr: (data: Buffer) => (stderr += data.toString())
    }
  });

  if (resp !== 0) {
    core.setFailed(stderr);
  }

  core.info(`Using the install at ${path}`);
  return path;
}

export async function installLint(version: string): Promise<string> {
  if (version === 'none') {
    core.info(`Assuming a version of vale is already available.`);
    return await lookupLint();
  }

  core.info(`Installing Vale version '${version}' ...`);
  if (version === 'latest') {
    const response = await fetch(last);
    const vs = response.url;
    const parts = vs.split(`/`);
    version = parts[parts.length - 1].substring(1);
  }
  const assetName = `vale_${version}_Linux_64-bit.tar.gz`;
  const url = `${releases}/v${version}/${assetName}`;
  assertHttps(url, 'Vale');
  const archivePath = await tc.downloadTool(url);
  await verifyChecksum(
    archivePath,
    `${releases}/v${version}/vale_${version}_checksums.txt`,
    assetName
  );

  let extractedDir = '';

  const args = ['xz'];
  if (process.platform.toString() != 'darwin') {
    args.push('--overwrite');
  }
  extractedDir = await tc.extractTar(archivePath, process.env.HOME, args);

  const lintPath = path.join(extractedDir, `vale`);
  core.info(`Installed version '${version}' into '${lintPath}'.`);

  return lintPath;
}

export async function installReviewDog(
  version: string,
  url?: string
): Promise<string> {
  core.info(`Installing ReviewDog version '${version}' ...`);

  const isCustomUrl = !!url;
  const assetName = `reviewdog_${version}_Linux_x86_64.tar.gz`;
  if (!url) {
    url = `https://github.com/reviewdog/reviewdog/releases/download/v${version}/${assetName}`;
  }
  assertHttps(url, 'reviewdog');

  const archivePath = await tc.downloadTool(url);

  if (isCustomUrl) {
    core.warning(
      `Skipping checksum verification for reviewdog: a custom 'reviewdog_url' was provided.`
    );
  } else {
    await verifyChecksum(
      archivePath,
      `https://github.com/reviewdog/reviewdog/releases/download/v${version}/checksums.txt`,
      assetName
    );
  }

  let extractedDir = '';

  const args = ['xz'];
  if (process.platform.toString() != 'darwin') {
    args.push('--overwrite');
  }

  extractedDir = await tc.extractTar(archivePath, process.env.HOME, args);

  const reviewdogPath = path.join(extractedDir, `reviewdog`);

  core.info(`Installed reviewdog from '${url}' into '${reviewdogPath}'.`);
  return reviewdogPath;
}
