import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let root: string
let bin: string
let crontab: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'family-schedule-test-')))
  bin = join(root, 'test-bin')
  crontab = join(root, 'crontab')
  mkdirSync(bin)
  for (const [name, content] of Object.entries({
    timedatectl: '#!/bin/sh\nprintf "%s\\n" "${TEST_TIMEZONE:-Asia/Shanghai}"\n',
    systemctl: '#!/bin/sh\nexit 0\n',
    crontab: `#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv[2] === '-l') {
  process.stdout.write(fs.readFileSync(process.env.TEST_CRONTAB, 'utf8'))
} else if (process.argv[2] === '-') {
  fs.writeFileSync(process.env.TEST_CRONTAB, fs.readFileSync(0))
} else process.exit(1)
`,
  })) {
    writeFileSync(join(bin, name), content)
    chmodSync(join(bin, name), 0o755)
  }
  writeFileSync(crontab, '15 3 * * * /existing/job\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function install(timezone = 'Asia/Shanghai') {
  return spawnSync('bash', [resolve('scripts/install-schedule.sh')], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DEPLOY_ROOT: root,
      TEST_CRONTAB: crontab,
      TEST_TIMEZONE: timezone,
    },
  })
}

describe('weekly deployment schedule', () => {
  it('installs an idempotent Thursday 22:00 entry while preserving other jobs', () => {
    const first = install()
    expect(first.status, first.stderr).toBe(0)
    const second = install()
    expect(second.status, second.stderr).toBe(0)
    const contents = readFileSync(crontab, 'utf8')
    expect(contents).toContain('15 3 * * * /existing/job\n')
    expect(contents).toContain(`0 22 * * 4 DEPLOY_ROOT=${root} /bin/bash ${root}/bin/run-weekly.sh\n`)
    expect(contents.match(/BEGIN FAMILY_TREE_WEEKLY/g)).toHaveLength(1)
    for (const name of ['pull-image.py', 'run-weekly.sh', 'deploy.sh']) {
      expect(readFileSync(join(root, 'bin', name), 'utf8')).toBe(readFileSync(resolve('scripts', name), 'utf8'))
    }
    for (const name of ['docker-compose.yml', 'docker-compose.production.yml']) {
      expect(readFileSync(join(root, 'bin', name), 'utf8')).toBe(readFileSync(resolve(name), 'utf8'))
    }
  })

  it('refuses an unexpected system timezone without changing the crontab', () => {
    const result = install('UTC')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Asia/Shanghai')
    expect(readFileSync(crontab, 'utf8')).toBe('15 3 * * * /existing/job\n')
  })

  it('refuses malformed managed markers without changing existing jobs', () => {
    const original = '15 3 * * * /existing/job\n# BEGIN FAMILY_TREE_WEEKLY\n'
    writeFileSync(crontab, original)
    expect(install().status).not.toBe(0)
    expect(readFileSync(crontab, 'utf8')).toBe(original)
  })
})
