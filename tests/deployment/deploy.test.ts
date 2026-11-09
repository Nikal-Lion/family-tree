import { createHash, pbkdf2Sync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let root: string
let release: string
let bin: string
const script = resolve('scripts/deploy.sh')
const mock = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const command = path.basename(process.argv[1])
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify([command, ...args]) + '\\n')
if (command === 'flock' && process.env.FAIL_STAGE === 'lock') process.exit(1)
if (command === 'docker') {
  if (args[0] === 'ps' && process.env.TEST_EXISTING === 'yes') console.log('old-app')
  if (args[0] === 'volume' && args[1] === 'ls' && process.env.TEST_EXISTING === 'yes') {
    console.log('family-tree_family-tree-data')
  }
  if (args[0] === 'run' && process.env.FAIL_STAGE === 'backup') process.exit(9)
  if (args[0] === 'compose' && args.includes('up') && process.env.FAIL_STAGE === 'start') process.exit(9)
}
if (command === 'curl') {
  if (process.env.FAIL_STAGE === 'health') process.exit(22)
  console.log(args.at(-1).endsWith('/login') ? '<script src="/family/assets/app.js"></script>' : '{"ok":true}')
}
`

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'family-deploy-test-')))
  release = join(root, 'releases', 'v0.2.0-123-1')
  bin = join(root, 'bin')
  mkdirSync(release, { recursive: true })
  mkdirSync(bin)
  for (const command of ['docker', 'curl', 'flock']) {
    const file = join(bin, command)
    writeFileSync(file, mock)
    chmodSync(file, 0o755)
  }
  writeFileSync(join(release, 'image.txt'), 'family-tree:0.2.0\n')
  const digest = createHash('sha256').update('family-tree:0.2.0\n').digest('hex')
  writeFileSync(join(release, 'SHA256SUMS'), `${digest}  image.txt\n`)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function run(options: { existing?: boolean; fail?: string } = {}) {
  if (options.existing) writeFileSync(join(root, '.env'), 'EXISTING_CONFIG=preserved\n')
  return spawnSync('bash', [script, release], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DEPLOY_ROOT: root,
      TEST_LOG: join(root, 'commands.log'),
      TEST_EXISTING: options.existing ? 'yes' : 'no',
      FAIL_STAGE: options.fail ?? '',
    },
  })
}

function commands(): string[][] {
  return readFileSync(join(root, 'commands.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
}

describe('production deployment', () => {
  it('creates protected first-run credentials and switches current only after health checks', () => {
    const result = run()
    expect(result.status, result.stderr).toBe(0)
    const password = readFileSync(join(root, 'bootstrap-password.txt'), 'utf8').trim()
    const env = readFileSync(join(root, '.env'), 'utf8')
    const [, salt, hash] = env.match(/pbkdf2_sha256\$100000\$([a-f0-9]+)\$([a-f0-9]+)/)!
    expect(pbkdf2Sync(password, Buffer.from(salt!, 'hex'), 100000, 32, 'sha256').toString('hex')).toBe(hash)
    expect(statSync(join(root, '.env')).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, 'bootstrap-password.txt')).mode & 0o777).toBe(0o600)
    expect(result.stdout + result.stderr).not.toContain(password)
    expect(result.stdout + result.stderr).not.toContain(hash)
    expect(readlinkSync(join(root, 'current'))).toBe(release)
    expect(readFileSync(join(root, 'current-image.txt'), 'utf8')).toBe('family-tree:0.2.0\n')
  })

  it('stops the old application and backs up the whole volume before starting the new one', () => {
    const result = run({ existing: true })
    expect(result.status, result.stderr).toBe(0)
    const calls = commands()
    const stop = calls.findIndex(args => args[0] === 'docker' && args[1] === 'stop')
    const backup = calls.findIndex(args => args[0] === 'docker' && args[1] === 'run')
    const start = calls.findIndex(args => args[1] === 'compose' && args.includes('up'))
    expect(stop).toBeGreaterThan(-1)
    expect(backup).toBeGreaterThan(stop)
    expect(start).toBeGreaterThan(backup)
    expect(calls[backup]).toContain('type=volume,source=family-tree_family-tree-data,target=/data,readonly')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('EXISTING_CONFIG=preserved\n')
  })

  it('restarts the old application if its backup fails before the new image starts', () => {
    const result = run({ existing: true, fail: 'backup' })
    expect(result.status).toBe(9)
    expect(commands()).toContainEqual(['docker', 'start', 'old-app'])
    expect(commands().some(args => args[1] === 'compose' && args.includes('up'))).toBe(false)
    expect(existsSync(join(root, 'current'))).toBe(false)
  })

  it.each(['start', 'health'])('stops a failed new deployment (%s) without silently rolling back its database', (fail) => {
    const result = run({ existing: true, fail })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Do not blindly roll back across schema changes')
    expect(commands().some(args => args[1] === 'compose' && args.includes('stop'))).toBe(true)
    expect(commands()).not.toContainEqual(['docker', 'start', 'old-app'])
    expect(existsSync(join(root, 'current'))).toBe(false)
  })

  it('rejects concurrent deployments before touching Docker', () => {
    expect(run({ fail: 'lock' }).status).not.toBe(0)
    expect(commands().some(args => args[0] === 'docker')).toBe(false)
  })

  it('rejects a corrupt bundle before loading its image', () => {
    writeFileSync(join(release, 'image.txt'), 'family-tree:tampered\n')
    expect(run().status).not.toBe(0)
    expect(commands().some(args => args[0] === 'docker')).toBe(false)
  })
})
