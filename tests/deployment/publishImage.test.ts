import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = resolve('scripts/publish-image.sh')
const repository = 'registry.cn-shanghai.aliyuncs.com/wolfife/family'
let root: string
let bin: string

const dockerMock = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + '\\n')
if (args[0] === 'pull') {
  const ref = args[1]
  const exists = ref.endsWith(':latest') ? process.env.TEST_LATEST : process.env.TEST_VERSION_TAG
  if (process.env.TEST_FAIL === 'network' || !exists) {
    console.error(process.env.TEST_FAIL === 'network' ? 'connection refused' : 'manifest unknown')
    process.exit(1)
  }
} else if (args[0] === 'image' && args[1] === 'inspect') {
  const format = args[3]
  const ref = args[4]
  if (process.env.TEST_FAIL === 'inspect') process.exit(1)
  if (format.includes('Labels')) {
    console.log(process.env.TEST_LATEST_VERSION || '')
  } else if (ref.endsWith(':latest')) {
    console.log(process.env.TEST_LATEST_ID || '')
  } else if (ref === '${repository}:0.2.3' && process.env.TEST_VERSION_TAG) {
    console.log(process.env.TEST_VERSION_ID || 'image-v023')
  } else {
    console.log('image-v023')
  }
}
`

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'family-publish-test-')))
  bin = join(root, 'test-bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'docker'), dockerMock)
  chmodSync(join(bin, 'docker'), 0o755)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function run(options: Record<string, string> = {}, version = '0.2.3', repositoryName = repository) {
  return spawnSync('bash', [script, version, repositoryName], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      TEST_LOG: join(root, 'docker.log'),
      ...options,
    },
  })
}

function commands(): string[][] {
  return readFileSync(join(root, 'docker.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
}

describe('ACR image publishing', () => {
  it('creates version and latest tags on first publish', () => {
    const result = run()
    expect(result.status, result.stderr).toBe(0)
    expect(commands()).toContainEqual(['tag', 'family-tree:0.2.3', `${repository}:0.2.3`])
    expect(commands()).toContainEqual(['push', `${repository}:0.2.3`])
    expect(commands()).toContainEqual(['tag', 'family-tree:0.2.3', `${repository}:latest`])
    expect(commands()).toContainEqual(['push', `${repository}:latest`])
  })

  it('resumes a version push and does not rewrite matching tags', () => {
    const result = run({
      TEST_VERSION_TAG: 'yes',
      TEST_VERSION_ID: 'image-v023',
      TEST_LATEST: 'yes',
      TEST_LATEST_VERSION: '0.2.3',
      TEST_LATEST_ID: 'image-v023',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(commands().some(args => args[0] === 'push')).toBe(false)
  })

  it('advances latest when the current registry version is older', () => {
    const result = run({
      TEST_LATEST: 'yes',
      TEST_LATEST_VERSION: '0.2.2',
      TEST_LATEST_ID: 'image-v022',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(commands()).toContainEqual(['push', `${repository}:latest`])
  })

  it('refuses to roll latest back to an older version', () => {
    const result = run({
      TEST_LATEST: 'yes',
      TEST_LATEST_VERSION: '0.2.4',
      TEST_LATEST_ID: 'image-v024',
    })
    expect(result.status, `${result.stdout}\n${result.stderr}\n${readFileSync(join(root, 'docker.log'), 'utf8')}`).not.toBe(0)
    expect(result.stderr).toContain('Refusing to move latest backwards')
    expect(commands().some(args => args[0] === 'push' && args[1].endsWith(':latest'))).toBe(false)
  })

  it('refuses an already-used version tag that points at another image', () => {
    const result = run({ TEST_VERSION_TAG: 'yes', TEST_VERSION_ID: 'different-image' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('already points to a different image')
    expect(commands().some(args => args[0] === 'push')).toBe(false)
  })

  it('does not treat registry network errors as a missing image', () => {
    const result = run({ TEST_FAIL: 'network' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Could not safely inspect the existing version tag')
    expect(commands().some(args => args[0] === 'push')).toBe(false)
  })

  it('validates version and repository inputs before contacting the registry', () => {
    expect(run({}, 'latest').status).not.toBe(0)
    expect(run({}, '0.2.3', 'registry-vpc.cn-shanghai.aliyuncs.com/wolfife/family').status).not.toBe(0)
  })
})
