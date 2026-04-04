import { drizzle } from 'drizzle-orm/d1'
import { eq, desc, isNull, sql } from 'drizzle-orm'
import * as schema from './schema'

/**
 * D1 数据库服务层
 */

interface Env {
  DB: D1Database
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
  exec(query: string): Promise<unknown>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<D1QueryResult<T>>
}

interface D1QueryResult<T> {
  results?: T[]
}

function getDb(env: Env) {
  return drizzle(env.DB)
}

// Member 操作
export async function getAllMembers(env: Env) {
  try {
    const db = getDb(env)
    return await db.select().from(schema.members).all()
  } catch (error) {
    console.error('Failed to get all members:', error)
    throw new Error('查询成员列表失败')
  }
}

export async function getMemberById(env: Env, id: number) {
  try {
    const db = getDb(env)
    return await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, id))
      .get()
  } catch (error) {
    console.error(\Failed to get member \:\, error)
    throw new Error(\查询成员 \ 失败\)
  }
}

export async function createMember(env: Env, data: {
  id: number
  name: string
  parentId?: number | null
  gender?: '男' | '女'
  spouseIds?: number[]
  birthDate?: string
  photoUrl?: string
  biography?: string
}) {
  try {
    const db = getDb(env)
    const now = Date.now()
    
    const result = await db
      .insert(schema.members)
      .values({
        id: data.id,
        name: data.name,
        parentId: data.parentId ?? null,
        gender: data.gender ?? '男',
        spouseIds: JSON.stringify(data.spouseIds ?? []),
        birthDate: data.birthDate,
        photoUrl: data.photoUrl,
        biography: data.biography,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    
    return result
  } catch (error) {
    console.error('Failed to create member:', error)
    throw new Error('创建成员失败')
  }
}

export async function updateMember(env: Env, id: number, data: Partial<{
  name: string
  parentId: number | null
  gender: '男' | '女'
  spouseIds: number[]
  birthDate: string
  photoUrl: string
  biography: string
}>) {
  try {
    const db = getDb(env)
    const now = Date.now()

    const updateData: any = {
      updatedAt: now,
    }

    if (data.name !== undefined) updateData.name = data.name
    if (data.parentId !== undefined) updateData.parentId = data.parentId
    if (data.gender !== undefined) updateData.gender = data.gender
    if (data.spouseIds !== undefined) updateData.spouseIds = JSON.stringify(data.spouseIds)
    if (data.birthDate !== undefined) updateData.birthDate = data.birthDate
    if (data.photoUrl !== undefined) updateData.photoUrl = data.photoUrl
    if (data.biography !== undefined) updateData.biography = data.biography

    return await db
      .update(schema.members)
      .set(updateData)
      .where(eq(schema.members.id, id))
      .returning()
      .get()
  } catch (error) {
    console.error(\Failed to update member \:\, error)
    throw new Error(\更新成员 \ 失败\)
  }
}

export async function deleteMember(env: Env, id: number) {
  try {
    const db = getDb(env)
    const descendants = await getDescendants(env, id)
    const allIdsToDelete = [id, ...descendants.map(m => m.id)]

    const statements = [
      db.delete(schema.familyEvents)
        .where(sql\\ IN (\)\)
        .getSQL(),
      
      db.delete(schema.tracks)
        .where(sql\\ IN (\)\)
        .getSQL(),
      
      db.delete(schema.members)
        .where(sql\\ IN (\)\)
        .getSQL(),
    ]

    await db.batch(statements as any)
    return allIdsToDelete.length
  } catch (error) {
    console.error(\Failed to delete member \:\, error)
    throw new Error(\删除成员 \ 失败\)
  }
}

async function getDescendants(env: Env, parentId: number): Promise<typeof schema.members.\[]> {
  const db = getDb(env)
  
  const children = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.parentId, parentId))
    .all()

  let allDescendants: typeof schema.members.\[] = [...children]

  for (const child of children) {
    const grandChildren = await getDescendants(env, child.id)
    allDescendants = [...allDescendants, ...grandChildren]
  }

  return allDescendants
}

// Family Event 操作
export async function getAllEvents(env: Env) {
  try {
    const db = getDb(env)
    return await db
      .select()
      .from(schema.familyEvents)
      .orderBy(desc(schema.familyEvents.date))
      .all()
  } catch (error) {
    console.error('Failed to get all events:', error)
    throw new Error('查询事件列表失败')
  }
}

export async function getEventsByMemberId(env: Env, memberId: number) {
  try {
    const db = getDb(env)
    return await db
      .select()
      .from(schema.familyEvents)
      .where(eq(schema.familyEvents.memberId, memberId))
      .orderBy(desc(schema.familyEvents.date))
      .all()
  } catch (error) {
    console.error(\Failed to get events for member \:\, error)
    throw new Error(\查询成员 \ 的事件失败\)
  }
}

export async function createEvent(env: Env, data: {
  id: number
  memberId?: number | null
  type: '婚' | '丧' | '嫁' | '娶' | '生' | '卒' | '其他'
  title: string
  date: string
  description?: string
}) {
  try {
    const db = getDb(env)
    const now = new Date().toISOString()

    return await db
      .insert(schema.familyEvents)
      .values({
        id: data.id,
        memberId: data.memberId ?? null,
        type: data.type,
        title: data.title,
        date: data.date,
        description: data.description,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
  } catch (error) {
    console.error('Failed to create event:', error)
    throw new Error('创建事件失败')
  }
}

export async function updateEvent(env: Env, id: number, data: Partial<{
  memberId: number | null
  type: '婚' | '丧' | '嫁' | '娶' | '生' | '卒' | '其他'
  title: string
  date: string
  description: string
}>) {
  try {
    const db = getDb(env)
    const now = new Date().toISOString()

    const updateData: any = {
      updatedAt: now,
    }

    if (data.memberId !== undefined) updateData.memberId = data.memberId
    if (data.type !== undefined) updateData.type = data.type
    if (data.title !== undefined) updateData.title = data.title
    if (data.date !== undefined) updateData.date = data.date
    if (data.description !== undefined) updateData.description = data.description

    return await db
      .update(schema.familyEvents)
      .set(updateData)
      .where(eq(schema.familyEvents.id, id))
      .returning()
      .get()
  } catch (error) {
    console.error(\Failed to update event \:\, error)
    throw new Error(\更新事件 \ 失败\)
  }
}

export async function deleteEvent(env: Env, id: number) {
  try {
    const db = getDb(env)
    await db
      .delete(schema.familyEvents)
      .where(eq(schema.familyEvents.id, id))
      .run()
  } catch (error) {
    console.error(\Failed to delete event \:\, error)
    throw new Error(\删除事件 \ 失败\)
  }
}

// Track 操作
export async function getAllTracks(env: Env) {
  try {
    const db = getDb(env)
    return await db
      .select()
      .from(schema.tracks)
      .orderBy(desc(schema.tracks.createdAt))
      .all()
  } catch (error) {
    console.error('Failed to get all tracks:', error)
    throw new Error('查询轨迹列表失败')
  }
}

export async function getTrackById(env: Env, id: number) {
  try {
    const db = getDb(env)
    return await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .get()
  } catch (error) {
    console.error(\Failed to get track \:\, error)
    throw new Error(\查询轨迹 \ 失败\)
  }
}

export async function createTrack(env: Env, data: {
  id: number
  name: string
  memberId?: number | null
  points: unknown[]
  startPoint: unknown
  endPoint: unknown
  stats: unknown
}) {
  try {
    const db = getDb(env)
    const now = new Date().toISOString()

    return await db
      .insert(schema.tracks)
      .values({
        id: data.id,
        name: data.name,
        memberId: data.memberId ?? null,
        pointsJson: JSON.stringify(data.points),
        startPointJson: JSON.stringify(data.startPoint),
        endPointJson: JSON.stringify(data.endPoint),
        statsJson: JSON.stringify(data.stats),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
  } catch (error) {
    console.error('Failed to create track:', error)
    throw new Error('创建轨迹失败')
  }
}

export async function updateTrack(env: Env, id: number, data: Partial<{
  name: string
  memberId: number | null
  points: unknown[]
  startPoint: unknown
  endPoint: unknown
  stats: unknown
}>) {
  try {
    const db = getDb(env)
    const now = new Date().toISOString()

    const updateData: any = {
      updatedAt: now,
    }

    if (data.name !== undefined) updateData.name = data.name
    if (data.memberId !== undefined) updateData.memberId = data.memberId
    if (data.points !== undefined) updateData.pointsJson = JSON.stringify(data.points)
    if (data.startPoint !== undefined) updateData.startPointJson = JSON.stringify(data.startPoint)
    if (data.endPoint !== undefined) updateData.endPointJson = JSON.stringify(data.endPoint)
    if (data.stats !== undefined) updateData.statsJson = JSON.stringify(data.stats)

    return await db
      .update(schema.tracks)
      .set(updateData)
      .where(eq(schema.tracks.id, id))
      .returning()
      .get()
  } catch (error) {
    console.error(\Failed to update track \:\, error)
    throw new Error(\更新轨迹 \ 失败\)
  }
}

export async function deleteTrack(env: Env, id: number) {
  try {
    const db = getDb(env)
    await db
      .delete(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .run()
  } catch (error) {
    console.error(\Failed to delete track \:\, error)
    throw new Error(\删除轨迹 \ 失败\)
  }
}

// 元数据操作
export async function getMetadata(env: Env, key: string) {
  try {
    const db = getDb(env)
    const result = await db
      .select()
      .from(schema.metadata)
      .where(eq(schema.metadata.key, key))
      .get()
    return result?.value ?? null
  } catch (error) {
    console.error(\Failed to get metadata \:\, error)
    return null
  }
}

export async function setMetadata(env: Env, key: string, value: string) {
  try {
    const db = getDb(env)
    return await db
      .insert(schema.metadata)
      .values({ key, value })
      .onConflictDoUpdate({
        target: schema.metadata.key,
        set: { value },
      })
      .returning()
      .get()
  } catch (error) {
    console.error(\Failed to set metadata \:\, error)
    throw new Error(\设置元数据 \ 失败\)
  }
}

// 批量操作
export async function batchCreateMembers(env: Env, members: Array<{
  id: number
  name: string
  parentId?: number | null
  gender?: '男' | '女'
  spouseIds?: number[]
  birthDate?: string
  photoUrl?: string
  biography?: string
}>) {
  try {
    const db = getDb(env)
    const now = Date.now()

    const statements = members.map(data =>
      db
        .insert(schema.members)
        .values({
          id: data.id,
          name: data.name,
          parentId: data.parentId ?? null,
          gender: data.gender ?? '男',
          spouseIds: JSON.stringify(data.spouseIds ?? []),
          birthDate: data.birthDate,
          photoUrl: data.photoUrl,
          biography: data.biography,
          createdAt: now,
          updatedAt: now,
        })
        .getSQL()
    )

    await db.batch(statements as any)
    return members.length
  } catch (error) {
    console.error('Failed to batch create members:', error)
    throw new Error('批量创建成员失败')
  }
}

export async function isDescendantOf(env: Env, memberId: number, ancestorId: number): Promise<boolean> {
  const db = getDb(env)
  
  let currentId: number | null = memberId
  const visited = new Set<number>()

  while (currentId !== null && currentId !== undefined) {
    if (visited.has(currentId)) {
      return false
    }
    visited.add(currentId)

    if (currentId === ancestorId) {
      return true
    }

    const member = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, currentId))
      .get()

    currentId = member?.parentId ?? null
  }

  return false
}
