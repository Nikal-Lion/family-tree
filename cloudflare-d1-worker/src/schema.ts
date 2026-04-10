import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core'

/**
 * Members 表 - 存储家族成员信息
 */
export const members = sqliteTable('members', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  parentId: integer('parent_id').references(() => members.id, { onDelete: 'set null' }),
  gender: text('gender', { enum: ['男', '女'] }).default('男').notNull(),
  spouseIds: text('spouse_ids').default('[]').notNull(),
  birthDate: text('birth_date'),
  photoUrl: text('photo_url'),
  biography: text('biography'),
  createdAt: integer('created_at'),
  updatedAt: integer('updated_at'),
})

/**
 * Family Events 表 - 存储家族事件（婚、生、丧等）
 */
export const familyEvents = sqliteTable('family_events', {
  id: integer('id').primaryKey(),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  type: text('type', { enum: ['婚', '丧', '嫁', '娶', '生', '卒', '其他'] }).notNull(),
  title: text('title').notNull(),
  date: text('date').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * Tracks 表 - 存储轨迹/地理位置数据
 */
export const tracks = sqliteTable('tracks', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  pointsJson: text('points_json').notNull(),
  startPointJson: text('start_point_json').notNull(),
  endPointJson: text('end_point_json').notNull(),
  statsJson: text('stats_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * Metadata 表 - 存储元数据（schema version、next_id 等）
 */
export const metadata = sqliteTable(
  'metadata',
  {
    key: text('key').notNull(),
    value: text('value'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key] }),
  }),
)