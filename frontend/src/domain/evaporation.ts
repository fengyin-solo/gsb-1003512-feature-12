/**
 * 蒸发观测的职责边界与纯业务规则。
 * 纯函数、不碰存储，方便在 service 与页面里复用。
 */
import type { EntryRow } from '@/data/types'

export const SHIFTS = ['白班', '夜班'] as const
export type Shift = (typeof SHIFTS)[number]

/** 记录人允许补录的字段：本班次蒸发量与环境读数，仅此四项。 */
export const BACKFILL_FIELDS = ['蒸发量', '水温', '气温', '风速'] as const

/** 提交审核时的环境读数三项，缺一项就触发「退回还是待核」的判定。 */
export const ENV_FIELDS = ['水温', '气温', '风速'] as const

/** 中间结论字段：退回补录时必须清空，原始读数不在其列。 */
export const CONCLUSION_FIELDS = ['复核人', '复核结论', '复核意见'] as const

export function normalizeShift(label: unknown): Shift {
  return String(label ?? '').includes('夜') ? '夜班' : '白班'
}

/**
 * 解析记录所属班次：
 * 旧记录没有「所属班次」字段，按观测日期兼容，统一归到当日白班，
 * 原始行不写回，保持旧数据原貌。
 */
export function resolveShift(row: Pick<EntryRow, string>): { shift: Shift; legacy: boolean } {
  const raw = String(row['所属班次'] ?? '').trim()
  if (!raw) {
    return { shift: '白班', legacy: true }
  }
  return { shift: normalizeShift(raw), legacy: false }
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/** 返回缺失的环境读数字段名；空数组表示三项齐全。 */
export function missingEnvFields(row: Pick<EntryRow, string>): string[] {
  return ENV_FIELDS.filter((field) => isBlank(row[field]))
}

/**
 * 提交审核的去向：环境三项齐全进待审核；缺一项进待核。
 * 蒸发量本身缺失则不允许提交（没有主体观测值）。
 */
export function decideSubmitTarget(row: Pick<EntryRow, string>):
  | { ok: true; target: '待审核' | '待核'; missing: string[] }
  | { ok: false; target: null; message: string } {
  if (isBlank(row['蒸发量'])) {
    return { ok: false, target: null, message: '蒸发量尚未补录，不能提交审核' }
  }
  const missing = missingEnvFields(row)
  return { ok: true, target: missing.length > 0 ? '待核' : '待审核', missing }
}

/** 退回补录：清空中道复核结论，保留原始读数（复核人无权改原始值）。 */
export function clearConclusions(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  for (const field of CONCLUSION_FIELDS) {
    delete next[field]
  }
  return next
}

export function isFiniteReading(value: unknown): boolean {
  if (isBlank(value)) return true
  const num = Number(String(value).trim())
  return Number.isFinite(num)
}
