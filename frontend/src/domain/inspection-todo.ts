/**
 * 巡检待办：复核通过（含各业务模块的「通过/校核/处置/验收」类终态动作）后，
 * 统一在巡检模块生成一条「现场校验」待办。其他模块复用同一入口。
 */
import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

export const FIELD_CHECK_TYPE = '待办类型'
export const FIELD_REF = '关联记录'

/** 各业务模块「终审通过」落到的状态：命中即需要现场校验。 */
const APPROVAL_TARGETS = new Set([
  '已通过',
  '已校核',
  '已复核',
  '已处置',
  '已验收',
  '已合格',
  '已刊印',
  '已批准',
])

export function isApprovalTarget(status: string): boolean {
  return APPROVAL_TARGETS.has(status)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function isFieldCheckTodo(row: EntryRow): boolean {
  return String(row[FIELD_CHECK_TYPE] ?? '') === '现场校验'
}

/**
 * 生成现场校验待办；同一来源重复通过不重复建单。
 * refKey 用「业务模块:记录编号」唯一标识来源。
 */
export function createFieldCheckTodo(params: {
  sourceKey: string
  sourceId: string | number
  station: string
  refLabel: string
  date: string
}): EntryRow {
  const rows = listRows('inspection')
  const refKey = `${params.sourceKey}:${params.sourceId}`
  const existing = rows.find(
    (row) => isFieldCheckTodo(row) && String(row[FIELD_REF] ?? '') === refKey,
  )
  if (existing) {
    return existing
  }

  const todo: EntryRow = {
    id: nextId(rows),
    status: '待巡检',
    pending: true,
    abnormal: false,
    记录编号: `CHK-${String(Date.now()).slice(-6)}-${String(nextId(rows)).padStart(2, '0')}`,
    站点编号: params.station,
    巡检日期: params.date,
    巡检人员: '待安排',
    检查项目: '现场校验',
    发现问题: `复核通过后现场核对：${params.refLabel}`,
    处理措施: '待现场核验数据与设备状态',
    巡检状态: '',
    [FIELD_CHECK_TYPE]: '现场校验',
    [FIELD_REF]: refKey,
  }
  saveRows('inspection', [...rows, todo])
  return todo
}

/** 取来源记录的站点编号字段：不同业务模块叫法不一，按模块元数据兜底。 */
export function stationOf(sourceKey: string, row: EntryRow): string {
  const meta = MODULE_BY_KEY.get(sourceKey)
  const candidate = meta?.fields.find((field) =>
    field.includes('站点') || field.includes('井点') || field.includes('所属站'),
  )
  return String((candidate && row[candidate]) ?? row['站点编号'] ?? '')
}
