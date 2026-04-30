import type { Spouse, SpouseInput } from '../types/spouse'

export function createSpouse(state: { spouses: Spouse[]; nextSpouseId: number }, input: SpouseInput): Spouse {
  const now = new Date().toISOString()
  const spouse: Spouse = {
    id: state.nextSpouseId,
    ...input,
    createdAt: now,
    updatedAt: now,
  }
  state.spouses.push(spouse)
  state.nextSpouseId += 1
  return spouse
}

export function updateSpouse(state: { spouses: Spouse[] }, id: number, patch: Partial<SpouseInput>): boolean {
  const target = state.spouses.find((s) => s.id === id)
  if (!target) return false
  Object.assign(target, patch, { updatedAt: new Date().toISOString() })
  return true
}

export function deleteSpouse(state: { spouses: Spouse[] }, id: number): boolean {
  const idx = state.spouses.findIndex((s) => s.id === id)
  if (idx < 0) return false
  state.spouses.splice(idx, 1)
  return true
}

export function deleteSpousesByHusband(state: { spouses: Spouse[] }, husbandId: number): number {
  const before = state.spouses.length
  state.spouses = state.spouses.filter((s) => s.husbandId !== husbandId)
  return before - state.spouses.length
}

export function findSpousesByHusband(state: { spouses: Spouse[] }, husbandId: number): Spouse[] {
  return state.spouses.filter((s) => s.husbandId === husbandId).sort((a, b) => a.order - b.order)
}
