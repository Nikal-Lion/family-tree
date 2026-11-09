import { pbkdf2Sync, randomBytes } from 'node:crypto'

async function readPassword(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.')
  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise((resolve, reject) => {
    let password = ''
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          reject(new Error('Cancelled.'))
          return
        }
        if (character === '\r' || character === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(password)
          return
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1)
        } else if (character >= ' ') {
          password += character
        }
      }
    }
    process.stdin.on('data', onData)
  })
}

const password = await readPassword('Initial administrator password (hidden): ')
if (!/^[\x20-\x7e]{12,128}$/.test(password) || /^\s*$/.test(password)) {
  throw new Error('Use a non-blank printable ASCII password between 12 and 128 characters.')
}

const salt = randomBytes(16)
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256')
console.log(`SYSADMIN_PASSWORD_PBKDF2='pbkdf2_sha256$100000$${salt.toString('hex')}$${hash.toString('hex')}'`)
