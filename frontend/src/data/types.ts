/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 蒸发观测的职责边界：记录人、复核人、外站人员三权分立。 */
export type OperatorRole = 'recorder' | 'reviewer' | 'external'

/** 班次：白班/夜班，旧记录缺班次时按观测日期兼容成白班。 */
export type ShiftKind = 'day' | 'night'

export const ROLE_LABELS: Record<OperatorRole, string> = {
  recorder: '记录人',
  reviewer: '复核人',
  external: '外站人员',
}

export const ROLE_ORDER: OperatorRole[] = ['recorder', 'reviewer', 'external']

export const DAY_SHIFT = '白班 08:00-20:00'
export const NIGHT_SHIFT = '夜班 20:00-08:00'

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 动作执行上下文：带谁在操作、哪个班次，越权由数据层直接拒绝。 */
export type ActionContext = {
  role: OperatorRole
  shift: ShiftKind
}

/** 蒸发记录解析出的班次信息。 */
export type ShiftInfo = {
  shift: ShiftKind
  label: string
  /** 旧记录没有所属班次、靠观测日期兼容出来时为 true。 */
  inferred: boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 联动生成的现场校验巡检待办编号（复核通过时回传）。 */
  todoId?: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
