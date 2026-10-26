import type { Database, SqlValue } from 'sql.js'

class Statement {
  constructor(private database: Database, private query: string, private values: SqlValue[] = []) {}
  bind(...values: unknown[]) {
    return new Statement(this.database, this.query, values.map((value): SqlValue => {
      if (value === null || typeof value === 'number' || typeof value === 'string' || value instanceof Uint8Array) return value
      throw new Error('Unsupported SQL parameter')
    }))
  }
  execute<T>() {
    const statement = this.database.prepare(this.query)
    try {
      statement.bind(this.values)
      const results: T[] = []
      while (statement.step()) results.push(statement.getAsObject() as T)
      return { results }
    } finally {
      statement.free()
    }
  }
  async all<T>() { return this.execute<T>() }
}

export class TestD1Database {
  constructor(public database: Database) { database.run('PRAGMA foreign_keys = ON') }
  prepare(query: string) { return new Statement(this.database, query) }
  async exec(query: string) { this.database.run(query) }
  async batch(statements: Statement[]) {
    this.database.run('BEGIN')
    try {
      const results = statements.map((statement) => statement.execute())
      this.database.run('COMMIT')
      return results
    } catch (error) {
      this.database.run('ROLLBACK')
      throw error
    }
  }
}
