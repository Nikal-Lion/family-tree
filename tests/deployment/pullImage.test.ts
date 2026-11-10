import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repository = 'registry-vpc.cn-shanghai.aliyuncs.com/wolfife/family'
const reference = `${repository}@sha256:${'a'.repeat(64)}`
const olderReference = `${repository}@sha256:${'b'.repeat(64)}`
let root: string
let bin: string

const dockerMock = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(['docker', ...args]) + '\\n')
if (args[0] === 'pull') {
  if (process.env.TEST_FAIL === 'pull') process.exit(1)
} else if (args[0] === 'image' && args[1] === 'inspect') {
  const image = JSON.parse(fs.readFileSync(process.env.TEST_METADATA, 'utf8'))
  if (args[2] === '${olderReference}') {
    image.Config.Labels['org.opencontainers.image.version'] = process.env.TEST_CURRENT_VERSION || '0.2.2'
  }
  if (process.env.TEST_FAIL === 'mismatch' && args[2].includes('@sha256:')) image.Id = 'different-image'
  console.log(JSON.stringify([image]))
} else process.exit(2)
`

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'family-image-test-')))
  bin = join(root, 'test-bin')
  mkdirSync(bin)
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(bin, 'docker'), dockerMock)
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env node
const fs = require('node:fs')
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(['curl', ...process.argv.slice(2)]) + '\\n')
if (process.env.TEST_FAIL === 'health' && process.argv.at(-1).startsWith('https:')) process.exit(22)
console.log('{"ok":true}')
`)
  for (const command of ['docker', 'curl']) chmodSync(join(bin, command), 0o755)
  for (const name of ['docker-compose.yml', 'docker-compose.production.yml']) {
    copyFileSync(resolve(name), join(root, 'bin', name))
  }
  copyFileSync(resolve('scripts/pull-image.py'), join(root, 'bin/pull-image.py'))
  copyFileSync(resolve('scripts/run-weekly.sh'), join(root, 'bin/run-weekly.sh'))
  writeFileSync(join(bin, 'timedatectl'), '#!/bin/sh\nprintf "Asia/Shanghai\\n"\n')
  chmodSync(join(bin, 'timedatectl'), 0o755)
  writeFileSync(join(root, 'bin/deploy.sh'), `#!/usr/bin/env bash
set -eu
cd "$1"
sha256sum --check SHA256SUMS
test "\${TEST_FAIL:-}" != deployment
cp image.txt "$DEPLOY_ROOT/current-image.txt"
printf '%s\\n' "$1" > "$DEPLOY_ROOT/deploy-called"
`)
  metadata()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function metadata(options: { version?: string; digest?: string; arch?: string; basePath?: string } = {}) {
  writeFileSync(join(root, 'image.json'), JSON.stringify({
    Id: 'sha256:image-config',
    RepoDigests: [options.digest ?? reference],
    Os: 'linux',
    Architecture: options.arch ?? 'amd64',
    Config: { Labels: {
      'org.opencontainers.image.version': options.version ?? '0.2.3',
      'org.family-tree.base-path': options.basePath ?? '/family/',
    } },
  }))
}

function run(fail = '', currentVersion = '', weekly = false, locked = false) {
  const script = join(root, 'bin', weekly ? 'run-weekly.sh' : 'pull-image.py')
  const args = locked ? ['-c', `
import fcntl, os, pathlib, subprocess, sys
with (pathlib.Path(os.environ["DEPLOY_ROOT"]) / "pull.lock").open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    sys.exit(subprocess.run([sys.executable, sys.argv[1]]).returncode)
`, script] : [script]
  return spawnSync(weekly ? 'bash' : 'python3', args, {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, DEPLOY_ROOT: root,
      TEST_METADATA: join(root, 'image.json'), TEST_LOG: join(root, 'commands.log'),
      TEST_FAIL: fail, TEST_CURRENT_VERSION: currentVersion,
    },
  })
}

function commands(): string[][] {
  return readFileSync(join(root, 'commands.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
}

describe('ACR weekly image deployment', () => {
  it('pulls latest and migrates an existing release to a digest with persistent Compose settings', () => {
    writeFileSync(join(root, 'current-image.txt'), 'family-tree:0.2.2\n')
    const result = run()
    expect(result.status, result.stderr).toBe(0)
    expect(commands()[0]).toEqual(['docker', 'pull', '--platform', 'linux/amd64', `${repository}:latest`])
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8')).toBe(`${reference}\n`)
    const release = readFileSync(join(root, 'deploy-called'), 'utf8').trim()
    expect(release).toMatch(/\/v0\.2\.3-\d+-\d+$/)
    for (const name of ['docker-compose.yml', 'docker-compose.production.yml']) {
      expect(readFileSync(join(release, name), 'utf8')).toBe(readFileSync(resolve(name), 'utf8'))
    }
    expect(existsSync(join(release, 'family-tree-image.tar.gz'))).toBe(false)
  })

  it('does not deploy an unchanged digest and verifies local and public health', () => {
    writeFileSync(join(root, 'current-image.txt'), `${reference}\n`)
    const result = run()
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
    expect(commands().filter(args => args[0] === 'curl').map(args => args.at(-1))).toEqual([
      'http://127.0.0.1:3000/healthz', 'https://wolfife.top/family/healthz',
    ])
    expect(run('health').status).not.toBe(0)
  })

  it('deploys a changed digest even when its version is unchanged', () => {
    writeFileSync(join(root, 'current-image.txt'), `${olderReference}\n`)
    const result = run('', '0.2.3')
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8')).toBe(`${reference}\n`)
  })

  it.each(['family-tree:9.0.0', olderReference])('refuses a downgrade from %s', (current) => {
    writeFileSync(join(root, 'current-image.txt'), `${current}\n`)
    const result = run('', '9.0.0')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('refusing downgrade')
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8')).toBe(`${current}\n`)
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
  })

  it.each([
    { version: 'latest' },
    { version: '' },
    { digest: 'other.example/family@sha256:' + 'a'.repeat(64) },
    { digest: 'registry.cn-shanghai.aliyuncs.com/wolfife/family@sha256:' + 'a'.repeat(64) },
    { arch: 'arm64' },
    { basePath: '/' },
  ])('rejects invalid image metadata: %j', (options) => {
    metadata(options)
    expect(run().status).not.toBe(0)
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
    expect(existsSync(join(root, 'current-image.txt'))).toBe(false)
  })

  it.each(['pull', 'mismatch', 'deployment'])('preserves the current image marker on %s failure', (fail) => {
    writeFileSync(join(root, 'current-image.txt'), 'family-tree:0.2.2\n')
    const result = run(fail)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Image deployment failed:')
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8')).toBe('family-tree:0.2.2\n')
  })

  it('rejects invalid current state before deploying', () => {
    writeFileSync(join(root, 'current-image.txt'), 'unexpected:latest\n')
    expect(run().stderr).toContain('Invalid current image marker')
    expect(existsSync(join(root, 'deploy-called'))).toBe(false)
  })

  it('refuses concurrent checks without contacting the registry', () => {
    const result = run('', '', false, true)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('already running')
    expect(existsSync(join(root, 'commands.log'))).toBe(false)
  })

  it('routes weekly checks to the registry and logs failures', () => {
    expect(run('', '', true).status).toBe(0)
    expect(readFileSync(join(root, 'logs/weekly-deploy.log'), 'utf8')).toContain('Weekly release check completed')
    expect(run('pull', '', true).status).not.toBe(0)
    expect(readFileSync(join(root, 'logs/weekly-deploy.log'), 'utf8')).toContain('Weekly release check failed')
    expect(readdirSync(join(root, 'releases'))).toHaveLength(1)
  })
})
