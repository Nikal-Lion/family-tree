import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const puller = resolve('scripts/pull-release.py')
let root: string
let bin: string
let fixture: string
let metadata: string
let archive: string

const curlMock = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const url = args.at(-1)
fs.appendFileSync(process.env.TEST_LOG, url + '\\n')
if (url.endsWith('/healthz')) {
  if (process.env.TEST_FAIL === 'health') process.exit(22)
  console.log('{"ok":true}')
} else {
  const output = args[args.indexOf('--output') + 1]
  if (url.endsWith('/releases/latest')) {
    if (process.env.TEST_FAIL === 'metadata') process.exit(22)
    fs.copyFileSync(process.env.TEST_METADATA, output)
  } else {
    if (process.env.TEST_FAIL === 'download') process.exit(28)
    fs.copyFileSync(process.env.TEST_ARCHIVE, output)
  }
}
`

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'family-pull-test-')))
  bin = join(root, 'test-bin')
  fixture = join(root, 'fixture')
  metadata = join(root, 'release.json')
  archive = join(root, 'bundle.tar.gz')
  mkdirSync(bin)
  mkdirSync(fixture)
  writeFileSync(join(bin, 'curl'), curlMock)
  chmodSync(join(bin, 'curl'), 0o755)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function hash(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex')
}

function createRelease(options: {
  tag?: string
  badDigest?: boolean
  badManifest?: boolean
  unsafeEntry?: boolean
  missingAsset?: boolean
  includeUpdater?: boolean
} = {}) {
  const tag = options.tag ?? 'v0.2.1'
  const image = `family-tree:${tag.slice(1)}`
  const files: Record<string, string> = {
    'image.txt': `${image}\n`,
    'family-tree-image.tar.gz': 'test image',
    'docker-compose.yml': 'services: {}\n',
    'docker-compose.production.yml': 'services: {}\n',
    'scripts/deploy.sh': `#!/usr/bin/env bash
set -eu
printf '%s\\n' '${image}' > "$DEPLOY_ROOT/current-image.txt"
printf '%s\\n' "$1" > "$DEPLOY_ROOT/deploy-called"
`,
  }
  if (options.includeUpdater) {
    files['scripts/pull-release.py'] = '# next puller\n'
    files['scripts/run-weekly.sh'] = '# next schedule runner\n'
  }
  const checksums = []
  for (const [name, content] of Object.entries(files)) {
    const path = join(fixture, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    checksums.push(`${hash(content)}  ${name}`)
  }
  writeFileSync(join(fixture, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
  if (options.badManifest) writeFileSync(join(fixture, 'image.txt'), 'tampered\n')
  if (options.unsafeEntry) writeFileSync(join(fixture, 'unexpected'), 'unexpected')
  const tar = spawnSync('tar', ['-czf', archive, '-C', fixture, '.'], {
    encoding: 'utf8',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  expect(tar.status, tar.stderr).toBe(0)
  const bytes = readFileSync(archive)
  const name = `family-tree-${tag}-linux-amd64.tar.gz`
  writeFileSync(metadata, JSON.stringify({
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: options.missingAsset ? [] : [{
      name,
      id: 123,
      url: 'https://api.github.com/repos/Nikal-Lion/family-tree/releases/assets/123',
      state: 'uploaded',
      browser_download_url: `https://github.com/Nikal-Lion/family-tree/releases/download/${tag}/${name}`,
      digest: `sha256:${options.badDigest ? '0'.repeat(64) : hash(bytes)}`,
      size: bytes.length,
    }],
  }))
  return { name, image }
}

function runPull(fail = '') {
  return spawnSync('python3', [puller], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DEPLOY_ROOT: root,
      TEST_METADATA: metadata,
      TEST_ARCHIVE: archive,
      TEST_LOG: join(root, 'curl.log'),
      TEST_FAIL: fail,
    },
  })
}

function requests() {
  return readFileSync(join(root, 'curl.log'), 'utf8').trim().split('\n')
}

describe('server-side release pull', () => {
  it('verifies and deploys a new release, then installs its checked updater', () => {
    const { image } = createRelease({ includeUpdater: true })
    const result = runPull()
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8').trim()).toBe(image)
    expect(readFileSync(join(root, 'deploy-called'), 'utf8').trim()).toMatch(/\/releases\/v0\.2\.1-\d+-\d+$/)
    expect(readFileSync(join(root, 'bin/pull-release.py'), 'utf8')).toBe('# next puller\n')
    expect(statSync(join(root, 'bin/pull-release.py')).mode & 0o777).toBe(0o700)
    expect(readdirSync(join(root, 'downloads'))).toEqual([])
  })

  it('reuses a verified cached bundle without downloading it again', () => {
    const { name } = createRelease()
    mkdirSync(join(root, 'downloads'))
    copyFileSync(archive, join(root, 'downloads', name))
    const result = runPull()
    expect(result.status, result.stderr).toBe(0)
    expect(requests().some(url => url.includes('/releases/assets/'))).toBe(false)
  })

  it('does not restart an unchanged version and checks its local health', () => {
    const { image } = createRelease()
    writeFileSync(join(root, 'current-image.txt'), `${image}\n`)
    const result = runPull()
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
    expect(requests()).toContain('http://127.0.0.1:3000/healthz')
    expect(requests().some(url => url.includes('/releases/assets/'))).toBe(false)
  })

  it('reports an unhealthy unchanged deployment without restarting it', () => {
    const { image } = createRelease()
    writeFileSync(join(root, 'current-image.txt'), `${image}\n`)
    expect(runPull('health').status).not.toBe(0)
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
  })

  it('refuses to downgrade and leaves the deployed version untouched', () => {
    createRelease({ tag: 'v0.2.0' })
    writeFileSync(join(root, 'current-image.txt'), 'family-tree:0.2.1\n')
    const result = runPull()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('refusing downgrade')
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8')).toBe('family-tree:0.2.1\n')
    expect(requests().some(url => url.includes('/releases/assets/'))).toBe(false)
  })

  it.each([
    [{ badDigest: true }, 'size or SHA-256'],
    [{ badManifest: true }, 'checksum mismatch'],
    [{ unsafeEntry: true }, 'unsafe release archive entry'],
    [{ missingAsset: true }, 'uploaded'],
  ])('refuses an invalid release (%j)', (options, error) => {
    createRelease(options)
    const result = runPull()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(error)
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
    expect(existsSync(join(root, 'current-image.txt'))).toBe(false)
  })

  it.each(['metadata', 'download'])('surfaces %s failures without stopping the current app', (fail) => {
    createRelease()
    writeFileSync(join(root, 'current-image.txt'), 'family-tree:0.2.0\n')
    const result = runPull(fail)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Release check failed')
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8')).toBe('family-tree:0.2.0\n')
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
  })
})
