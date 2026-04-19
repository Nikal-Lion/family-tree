import { sqliteTable, integer, real, text, primaryKey } from 'drizzle-orm/sqlite-core'

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
 * Member Profiles 表 - 成员扩展档案字段
 */
export const memberProfiles = sqliteTable('member_profiles', {
  memberId: integer('member_id').primaryKey().references(() => members.id, { onDelete: 'cascade' }),
  generationLabelRaw: text('generation_label_raw'),
  lineageBranch: text('lineage_branch'),
  rawNotes: text('raw_notes'),
  uncertaintyFlagsJson: text('uncertainty_flags_json').default('[]').notNull(),
})

/**
 * Name Aliases 表 - 成员名称别名体系
 */
export const nameAliases = sqliteTable('name_aliases', {
  id: integer('id').primaryKey(),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  isPreferred: integer('is_preferred').default(0).notNull(),
  note: text('note'),
  rawText: text('raw_text'),
})

/**
 * Temporal Expressions 表 - 纪年/时间表达
 */
export const temporalExpressions = sqliteTable('temporal_expressions', {
  id: integer('id').primaryKey(),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  rawText: text('raw_text').notNull(),
  calendarType: text('calendar_type').notNull(),
  normalizedDate: text('normalized_date'),
  precision: text('precision').notNull(),
  confidence: real('confidence').default(1).notNull(),
})

/**
 * Kinship Relations 表 - 关系边
 */
export const kinshipRelations = sqliteTable('kinship_relations', {
  id: integer('id').primaryKey(),
  fromMemberId: integer('from_member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  toMemberId: integer('to_member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(),
  status: text('status').default('active').notNull(),
  temporalId: integer('temporal_id').references(() => temporalExpressions.id, { onDelete: 'set null' }),
  note: text('note'),
  rawText: text('raw_text'),
})

/**
 * Burial Records 表 - 墓葬记录
 */
export const burialRecords = sqliteTable('burial_records', {
  id: integer('id').primaryKey(),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  temporalId: integer('temporal_id').references(() => temporalExpressions.id, { onDelete: 'set null' }),
  placeRaw: text('place_raw').notNull(),
  mountainDirection: text('mountain_direction'),
  fenjin: text('fenjin'),
  note: text('note'),
  rawText: text('raw_text'),
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

/**
 * Login Users 表 - 登录用户账号（手机号 + 角色）
 */
export const loginUsers = sqliteTable('login_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mobile: text('mobile').notNull().unique(),
  role: text('role', { enum: ['user', 'maintainer', 'sysadmin'] }).default('user').notNull(),
  enabled: integer('enabled').default(1).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * Auth Sessions 表 - 登录会话令牌
 */
export const authSessions = sqliteTable('auth_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenHash: text('token_hash').notNull().unique(),
  userId: integer('user_id').references(() => loginUsers.id, { onDelete: 'cascade' }).notNull(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})