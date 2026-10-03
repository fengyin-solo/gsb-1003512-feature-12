import { listRows, saveRows } from './local-store'
import type { EntryRow } from './types'

// 巡检待办的现场校验联动：蒸发复核通过、以及其他观测模块复核/校核通过时，
// 都在巡检模块落一条「待现场校验」待办，要求现场核对后再闭环。

export const INSPECTION_KEY = 'inspection'
export const FIELD_VERIFY_STATUS = '待现场校验'
export const FIELD_VERIFY_TASK = '现场校验'
const FIELD_VERIFY_PROJECT = '现场校验'

type FieldVerifyInput = {
  /** 来源模块，用于追溯，如「蒸发观测」。 */
  sourceModule: string
  /** 来源记录编号，如 EVAP-0003。 */
  sourceCode: string
  stationCode: string
  /** 校验事项，写入检查项目。 */
  subject: string
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextCode(rows: EntryRow[]): string {
  const seq = rows.reduce((max, row) => {
    const code = String(row['记录编号'] ?? '')
    const matched = code.startsWith('INSP-') ? Number(code.slice(5)) : 0
    return Math.max(max, Number.isFinite(matched) ? matched : 0)
  }, 0) + 1
  return `INSP-${String(seq).padStart(4, '0')}`
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 生成一条现场校验巡检待办。返回新待办编号。
 * 待办落在巡检模块、状态为「待现场校验」，巡检人员需现场核对后再走巡检动作闭环。
 */
export function createFieldVerifyTodo(input: FieldVerifyInput): number {
  const rows = listRows(INSPECTION_KEY)
  const id = nextId(rows)
  const todo: EntryRow = {
    id,
    status: FIELD_VERIFY_STATUS,
    pending: true,
    abnormal: false,
    记录编号: nextCode(rows),
    站点编号: input.stationCode,
    巡检日期: today(),
    巡检人员: '',
    检查项目: `${FIELD_VERIFY_PROJECT}：${input.subject}`,
    发现问题: '',
    处理措施: `来源：${input.sourceModule} ${input.sourceCode} 复核通过，需现场校验`,
    巡检状态: '',
    任务类型: FIELD_VERIFY_TASK,
  }
  saveRows(INSPECTION_KEY, [...rows, todo])
  return id
}
