import { DAY_SHIFT, NIGHT_SHIFT, type EntryRow, type ShiftInfo, type ShiftKind } from './types'

// 蒸发观测领域规则：班次兼容、环境读数完整性、本班次判定都收在这里，页面与整编取数共用。

export const EVAP_KEY = 'evaporation'
export const SHIFT_FIELD = '所属班次'
export const EVAP_AMOUNT_FIELD = '蒸发量'
export const ENV_FIELDS = ['气温', '水温', '风速'] as const

export const SHIFT_DAY: ShiftKind = 'day'
export const SHIFT_NIGHT: ShiftKind = 'night'

/** 复核中间结论字段名：退回时清空，复核通过后也清空。 */
export const REVIEW_NOTE = '复核中间结论'

/** 记录人可补录的字段：蒸发量 + 三项环境读数。 */
export const RECORD_FIELDS = [EVAP_AMOUNT_FIELD, ...ENV_FIELDS] as const

/** 蒸发记录的状态。 */
export const EVAP_STATUS = {
  collected: '已采集',
  reviewing: '待审核',
  pendingVerify: '待核',
  returned: '已退回',
  approved: '已通过',
  abnormal: '异常值',
} as const

/**
 * 解析一条蒸发记录的班次。
 * 旧记录没有「所属班次」字段时，按观测日期兼容为白班，并标记 inferred=true：
 * 原始值不动，仅在展示与本班次判定时使用兼容结果。
 */
export function resolveShift(row: EntryRow): ShiftInfo {
  const raw = String(row[SHIFT_FIELD] ?? '').trim()
  if (raw.includes('夜')) {
    return { shift: 'night', label: NIGHT_SHIFT, inferred: false }
  }
  if (raw.includes('白')) {
    return { shift: 'day', label: DAY_SHIFT, inferred: false }
  }
  return { shift: 'day', label: DAY_SHIFT, inferred: true }
}

export function shiftLabel(shift: ShiftKind): string {
  return shift === 'night' ? NIGHT_SHIFT : DAY_SHIFT
}

/** 环境读数是否齐：气温、水温、风速三项都有非空读数才算齐。 */
export function missingEnvFields(row: EntryRow): string[] {
  return ENV_FIELDS.filter((field) => String(row[field] ?? '').trim() === '')
}

/** 是否为可计量读数：蒸发量必须是非空数字。 */
export function isValidAmount(value: unknown): boolean {
  if (String(value ?? '').trim() === '') {
    return false
  }
  const num = Number(value)
  return Number.isFinite(num) && num >= 0
}
