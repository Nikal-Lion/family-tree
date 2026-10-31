export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

export function validateNewPassword(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return `密码须为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符`
  }
  if (!value.trim() || /^(.)\1+$/u.test(value)) return '请勿使用空白或单一重复字符作为密码'
  return null
}
