/**
 * 蒸发观测的角色职责边界（鉴权集中在这里，service 层强制执行，页面只做显隐）：
 * - observer 记录人：只能补录本班次蒸发量与环境读数、提交本班次记录；
 * - reviewer 复核人：可通过 / 退回 / 标记异常，不能修改原始读数，也不能提交；
 * - outsider 外站人员：只能查看，任何写动作都拒绝。
 */
import type { EntryRow } from '@/data/types'

import { resolveShift, type Shift } from './evaporation'

export type RoleKey = 'observer' | 'reviewer' | 'outsider'

export const ROLE_LABEL: Record<RoleKey, string> = {
  observer: '记录人',
  reviewer: '复核人',
  outsider: '外站人员',
}

export type ActorContext = {
  role: RoleKey
  shift: Shift
  name: string
}

export type AuthDecision = { allowed: boolean; message?: string }

/** 复核类动作：仅复核人；标记异常不改正原始值，同样归复核人。 */
const REVIEWER_ACTIONS = new Set(['确认通过', '退回补录', '标记异常'])

/** 记录类动作：仅记录人，且必须是本班次的记录。 */
const OBSERVER_ACTIONS = new Set(['提交审核'])

/** 同一记录人也不能对已退回之外的终态动作越权，补录入口走专门的 backfillEntry。 */
export function authorizeAction(
  action: string,
  row: Pick<EntryRow, string>,
  actor: ActorContext,
): AuthDecision {
  if (actor.role === 'outsider') {
    return { allowed: false, message: '外站人员只有查看权限，不能执行该操作' }
  }
  if (REVIEWER_ACTIONS.has(action)) {
    if (actor.role !== 'reviewer') {
      return { allowed: false, message: `只有复核人可以「${action}」，记录人不能越权复核` }
    }
    return { allowed: true }
  }
  if (OBSERVER_ACTIONS.has(action)) {
    if (actor.role !== 'observer') {
      return { allowed: false, message: `只有记录人可以「${action}」，复核人不能代替提交` }
    }
    const { shift } = resolveShift(row)
    if (shift !== actor.shift) {
      return {
        allowed: false,
        message: `该记录属于${shift}，当前班次为${actor.shift}，不能越班提交`,
      }
    }
    return { allowed: true }
  }
  return { allowed: false, message: `蒸发观测没有开放「${action}」动作` }
}

/**
 * 补录鉴权：记录人 + 本班次 + 记录未终审（已通过不再改原始值）。
 * 复核人 / 外站人员一律拒绝。
 */
export function authorizeBackfill(
  row: Pick<EntryRow, string>,
  actor: ActorContext,
): AuthDecision {
  if (actor.role === 'outsider') {
    return { allowed: false, message: '外站人员只有查看权限，不能补录' }
  }
  if (actor.role === 'reviewer') {
    return { allowed: false, message: '复核人只能复核，不能修改或补录原始读数' }
  }
  const { shift } = resolveShift(row)
  if (shift !== actor.shift) {
    return {
      allowed: false,
      message: `该记录属于${shift}，当前班次为${actor.shift}，不能补录别班记录`,
    }
  }
  if (String(row.status) === '已通过') {
    return { allowed: false, message: '该记录已复核通过并锁定，原始读数不能再补录改动' }
  }
  return { allowed: true }
}
