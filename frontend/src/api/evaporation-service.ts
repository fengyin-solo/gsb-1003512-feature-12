import { listRows, saveRows } from '@/data/local-store'
import {
  ENV_FIELDS,
  EVAP_AMOUNT_FIELD,
  EVAP_KEY,
  EVAP_STATUS,
  RECORD_FIELDS,
  REVIEW_NOTE,
  SHIFT_FIELD,
  missingEnvFields,
  resolveShift,
  shiftLabel,
} from '@/data/evaporation'
import { createFieldVerifyTodo } from '@/data/field-verify'
import type { ActionContext, ActionResult, EntryRow } from '@/data/types'

// 蒸发观测服务：记录人/复核人/外站人员的职责边界在这里强制执行。
// - 记录人：只能补录「本班次」的蒸发量与环境读数（气温/水温/风速），并提交审核；
// - 复核人：可退回（不允许改任何原始值）、确认通过；
// - 外站人员：只读，任何写动作直接拒绝。

function deny(message: string): ActionResult {
  return { ok: false, message }
}

function requireContext(ctx: ActionContext | undefined): ActionResult | null {
  if (!ctx) {
    return deny('缺少操作身份，无法执行蒸发观测操作')
  }
  return null
}

function findRow(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | null {
  const rows = listRows(EVAP_KEY)
  const index = rows.findIndex((item) => Number(item.id) === Number(id))
  if (index < 0) {
    return null
  }
  return { rows, index, row: rows[index] }
}

function persist(rows: EntryRow[], index: number, row: EntryRow): void {
  const next = [...rows]
  next[index] = row
  saveRows(EVAP_KEY, next)
}

function isOwnShift(row: EntryRow, ctx: ActionContext): boolean {
  return resolveShift(row).shift === ctx.shift
}

function statusOf(row: EntryRow): string {
  return String(row.status)
}

/** 记录人补录：只允许写本班次记录的蒸发量与三项环境读数，其余原始值一概不动。 */
export function supplementReading(
  id: number,
  values: Partial<Record<(typeof RECORD_FIELDS)[number], string>>,
  ctx: ActionContext,
): ActionResult {
  const noCtx = requireContext(ctx)
  if (noCtx) {
    return noCtx
  }
  if (ctx.role === 'external') {
    return deny('外站人员只有查看权限，不能补录蒸发观测记录')
  }
  if (ctx.role !== 'recorder') {
    return deny('只有记录人可以补录本班次蒸发量与环境读数')
  }
  const found = findRow(id)
  if (!found) {
    return deny(`没有找到编号为 ${id} 的蒸发观测记录`)
  }
  const { rows, index, row } = found
  if (!isOwnShift(row, ctx)) {
    return deny('只能补录本班次的蒸发观测记录，该记录不属于当前班次')
  }
  if (statusOf(row) === EVAP_STATUS.approved) {
    return deny('记录已复核通过，不能再补录；如需更正请由复核人退回')
  }
  const amount = String(values[EVAP_AMOUNT_FIELD] ?? '').trim()
  if (amount === '') {
    return deny('补录必须填写蒸发量')
  }
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return deny('蒸发量必须是不小于 0 的数字')
  }

  const patch: EntryRow = { ...row, [EVAP_AMOUNT_FIELD]: amount }
  for (const field of ENV_FIELDS) {
    const value = String(values[field] ?? '').trim()
    // 环境读数允许留空（缺项进待核），但只允许写这几个字段，绝不触碰其它原始值。
    patch[field] = value
  }
  persist(rows, index, patch)
  const missing = missingEnvFields(patch)
  return {
    ok: true,
    message:
      missing.length > 0
        ? `本班次蒸发量已补录；${missing.join('、')}缺项，提交后进入待核`
        : '本班次蒸发量与环境读数已补录，可提交审核',
  }
}

/** 记录人登记一条本班次新记录。 */
export function createEntry(
  draft: { stationCode: string; date: string; amount: string; waterTemp: string; airTemp: string; windSpeed: string },
  ctx: ActionContext,
  operator: string,
): ActionResult {
  if (ctx.role !== 'recorder') {
    return deny('只有记录人可以登记蒸发观测记录')
  }
  if (!draft.stationCode.trim() || !draft.date.trim()) {
    return deny('站点编号与观测日期不能为空')
  }
  const amount = draft.amount.trim()
  if (amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
    return deny('蒸发量必须是不小于 0 的数字')
  }
  const rows = listRows(EVAP_KEY)
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const seq =
    rows.reduce((max, row) => {
      const code = String(row['记录编号'] ?? '')
      const matched = code.startsWith('EVAP-') ? Number(code.slice(5)) : 0
      return Math.max(max, Number.isFinite(matched) ? matched : 0)
    }, 0) + 1
  const row: EntryRow = {
    id,
    status: EVAP_STATUS.collected,
    pending: true,
    abnormal: false,
    记录编号: `EVAP-${String(seq).padStart(4, '0')}`,
    站点编号: draft.stationCode.trim(),
    观测日期: draft.date.trim(),
    [SHIFT_FIELD]: shiftLabel(ctx.shift),
    [EVAP_AMOUNT_FIELD]: amount,
    水温: draft.waterTemp.trim(),
    气温: draft.airTemp.trim(),
    风速: draft.windSpeed.trim(),
    记录人: operator,
    记录状态: '',
  }
  saveRows(EVAP_KEY, [...rows, row])
  return { ok: true, message: `已登记本班次蒸发观测记录 ${String(row.记录编号)}` }
}

/**
 * 蒸发观测动作（提交审核 / 确认通过 / 退回 / 标记异常），带角色与状态校验。
 * 越权一律拒绝；退回不修改任何原始值并清空中间结论；确认通过生成现场校验待办。
 */
export function runEvaporationAction(id: number, action: string, ctx: ActionContext): ActionResult {
  const noCtx = requireContext(ctx)
  if (noCtx) {
    return noCtx
  }
  const found = findRow(id)
  if (!found) {
    return deny(`没有找到编号为 ${id} 的蒸发观测记录`)
  }
  const { rows, index, row } = found
  const current = statusOf(row)

  if (ctx.role === 'external') {
    return deny('外站人员只有查看权限，不能提交或复核')
  }

  switch (action) {
    case '提交审核': {
      if (ctx.role !== 'recorder') {
        return deny('只有记录人可以提交审核')
      }
      if (!isOwnShift(row, ctx)) {
        return deny('只能提交本班次的蒸发观测记录')
      }
      if (!([EVAP_STATUS.collected, EVAP_STATUS.returned] as string[]).includes(current)) {
        return deny(`当前状态「${current}」不能提交审核`)
      }
      const missing = missingEnvFields(row)
      // 气温、水温、风速缺一项：选择进入待核（不直接退回），由复核人按待核处理。
      const target = missing.length > 0 ? EVAP_STATUS.pendingVerify : EVAP_STATUS.reviewing
      const updated: EntryRow = {
        ...row,
        status: target,
        pending: true,
        abnormal: false,
        [REVIEW_NOTE]: missing.length ? `环境读数缺项：${missing.join('、')}` : '',
      }
      persist(rows, index, updated)
      return {
        ok: true,
        message:
          missing.length > 0
            ? `已提交，${missing.join('、')}缺项，记录进入待核`
            : '已提交审核，等待复核人复核',
      }
    }

    case '退回': {
      if (ctx.role !== 'reviewer') {
        return deny('只有复核人可以退回记录')
      }
      if (!([EVAP_STATUS.reviewing, EVAP_STATUS.pendingVerify] as string[]).includes(current)) {
        return deny(`当前状态「${current}」不能退回`)
      }
      // 退回：状态回到已退回，清空复核中间结论；原始值（蒸发量/环境读数）一律不改。
      const updated: EntryRow = {
        ...row,
        status: EVAP_STATUS.returned,
        pending: true,
        abnormal: false,
        [REVIEW_NOTE]: '',
      }
      persist(rows, index, updated)
      return { ok: true, message: '已退回记录人补录；复核中间结论已清空，原始值未改动' }
    }

    case '确认通过': {
      if (ctx.role !== 'reviewer') {
        return deny('只有复核人可以确认通过')
      }
      if (!([EVAP_STATUS.reviewing, EVAP_STATUS.pendingVerify] as string[]).includes(current)) {
        return deny(`当前状态「${current}」不能确认通过`)
      }
      const updated: EntryRow = {
        ...row,
        status: EVAP_STATUS.approved,
        pending: false,
        abnormal: false,
        [REVIEW_NOTE]: '',
      }
      persist(rows, index, updated)
      // 复核通过 → 巡检待办生成一条现场校验。
      const todoId = createFieldVerifyTodo({
        sourceModule: '蒸发观测',
        sourceCode: String(updated.记录编号 ?? ''),
        stationCode: String(updated.站点编号 ?? ''),
        subject: `核对 ${String(updated.观测日期 ?? '')} 蒸发量 ${String(updated[EVAP_AMOUNT_FIELD] ?? '')}mm`,
      })
      return {
        ok: true,
        todoId,
        message:
          (current === EVAP_STATUS.pendingVerify ? '待核记录已复核通过' : '复核已通过') +
          '，已生成一条现场校验巡检待办',
      }
    }

    case '标记异常': {
      if (ctx.role !== 'reviewer') {
        return deny('只有复核人可以标记异常')
      }
      if (current === EVAP_STATUS.abnormal) {
        return deny('记录已经是异常值，不用重复标记')
      }
      const updated: EntryRow = {
        ...row,
        status: EVAP_STATUS.abnormal,
        pending: true,
        abnormal: true,
        [REVIEW_NOTE]: '',
      }
      persist(rows, index, updated)
      return { ok: true, message: '已标记为异常值' }
    }

    default:
      return deny(`蒸发观测没有登记「${action}」这个动作`)
  }
}

export { REVIEW_NOTE as EVAP_REVIEW_NOTE, RECORD_FIELDS as EVAP_RECORD_FIELDS }
