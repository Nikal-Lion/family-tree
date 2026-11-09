import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type {
  SqliteDatabase as SqliteDatabaseContract,
  SqlitePreparedStatement,
  SqliteQueryResult,
} from '../api/index'

type SqliteValue = null | string | number | bigint | Buffer

class PreparedStatement implements SqlitePreparedStatement {
  private values: SqliteValue[] = []

  constructor(private readonly database: Database.Database, private readonly query: string) {}

  bind(...values: unknown[]): this {
    this.values = values.map((value) => {
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        return value
      }
      if (value instanceof Uint8Array) return Buffer.from(value)
      throw new TypeError('Unsupported SQLite parameter')
    })
    return this
  }

  async all<T>(): Promise<SqliteQueryResult<T>> {
    return this.execute<T>()
  }

  execute<T>(): SqliteQueryResult<T> {
    const statement = this.database.prepare(this.query)
    if (statement.reader) {
      return { results: statement.all(...this.values) as T[] }
    }
    statement.run(...this.values)
    return { results: [] }
  }
}

export class SqliteDatabase implements SqliteDatabaseContract {
  private readonly database: Database.Database

  constructor(path: string) {
    const databasePath = path === ':memory:' ? path : resolve(path)
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
    this.database = new Database(databasePath)
    this.database.pragma('foreign_keys = ON')
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = FULL')
    this.database.pragma('busy_timeout = 5000')
  }

  prepare(query: string): PreparedStatement {
    return new PreparedStatement(this.database, query)
  }

  async batch(statements: SqlitePreparedStatement[]): Promise<SqliteQueryResult<unknown>[]> {
    const transaction = this.database.transaction(() => statements.map((statement) => {
      if (!(statement instanceof PreparedStatement)) throw new TypeError('Invalid SQLite statement')
      return statement.execute()
    }))
    return transaction()
  }

  async exec(query: string): Promise<void> {
    this.database.exec(query)
  }

  check(): void {
    this.database.prepare('SELECT 1').get()
  }

  close(): void {
    this.database.close()
  }
}

export function createSqliteDatabase(path = process.env.DB_PATH || './data/family-tree.sqlite'): SqliteDatabase {
  return new SqliteDatabase(path)
}
