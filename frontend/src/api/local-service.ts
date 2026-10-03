import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import {
  type ActorContext,
  authorizeAction,
  authorizeBackfill,
} from '@/domain/authorization'
import {
  BACKFILL_FIELDS,
  clearConclusions,
  decideSubmitTarget,
  isFiniteReading,
} from '@/domain/evaporation'
import {
  createFieldCheckTodo,
  isApprovalTarget,
  stationOf,
} from '@/domain/inspection-todo'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '退回']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function isPending(meta: ModuleMeta, status: string): boolean {
  const terminals = meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  return !terminals.includes(status)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 执行记录动作。
 * 蒸发模块必须带操作者上下文（角色 + 班次），职责边界在 service 层强制；
 * 其他业务模块沿用通用流转，但复核通过后同样生成一条现场校验待办。
 */
export function runAction(
  key: string,
  id: number,
  action: string,
  actor?: ActorContext,
): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]

  let target = meta.actionTargets[action]
  let notice = ''

  if (key === 'evaporation') {
    if (!actor) {
      return { ok: false, message: '蒸发观测动作需要登录身份，越权提交一律拒绝' }
    }
    const auth = authorizeAction(action, row, actor)
    if (!auth.allowed) {
      return { ok: false, message: auth.message ?? '无权执行该操作' }
    }

    if (action === '提交审核') {
      const decision = decideSubmitTarget(row)
      if (!decision.ok) {
        return { ok: false, message: decision.message }
      }
      target = decision.target
      if (target === '待核') {
        notice = `气温/水温/风速缺测（${decision.missing.join('、')}），记录进入待核，等待现场校验`
      }
    }

    if (action === '退回补录') {
      // 退回：中间复核结论清空，原始读数原样保留，交回记录人补录。
      rows[index] = clearConclusions(row)
    }

    if (action === '确认通过') {
      rows[index] = {
        ...rows[index],
        复核人: actor.name,
        复核结论: '复核通过',
      }
    }
  } else if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }

  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }

  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: isPending(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  // 复核通过 → 巡检待办生成一条现场校验（别的模块走同一入口）。
  if (isApprovalTarget(target)) {
    const todo = createFieldCheckTodo({
      sourceKey: key,
      sourceId: String(row['记录编号'] ?? row.id),
      station: stationOf(key, row),
      refLabel: `${meta.name} ${String(row['记录编号'] ?? row.id)}`,
      date: today(),
    })
    notice = notice
      ? `${notice}；已生成现场校验待办 ${String(todo['记录编号'])}`
      : `已生成现场校验待办 ${String(todo['记录编号'])}，请到巡检记录安排现场核对`
  }

  const message = `${meta.entity}已${action}，当前状态「${target}」${notice ? `。${notice}` : ''}`
  return { ok: true, message }
}

/**
 * 记录人补录：只能补本班次的蒸发量与环境读数四项；
 * 复核人、外站人员、跨班、已通过记录一律拒绝，越权提交在 service 层拦截。
 */
export function backfillEntry(
  id: number,
  values: Partial<Record<(typeof BACKFILL_FIELDS)[number], string>>,
  actor: ActorContext,
): ActionResult {
  const meta = moduleMeta('evaporation')
  const rows = listRows('evaporation')
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const auth = authorizeBackfill(row, actor)
  if (!auth.allowed) {
    return { ok: false, message: auth.message ?? '无权补录' }
  }

  const patch: Record<string, string> = {}
  for (const field of BACKFILL_FIELDS) {
    const value = values[field]
    if (value === undefined) continue
    const text = String(value).trim()
    if (!isFiniteReading(text)) {
      return { ok: false, message: `${field}必须是数值，收到「${text}」` }
    }
    patch[field] = text
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: '没有可补录的读数' }
  }
  if (patch['蒸发量'] !== undefined && Number(patch['蒸发量']) < 0) {
    return { ok: false, message: '蒸发量不能为负值' }
  }

  const updated: EntryRow = {
    ...row,
    ...patch,
    记录人: String(row['记录人'] ?? actor.name),
  }
  const next = [...rows]
  next[index] = updated
  saveRows('evaporation', next)
  return { ok: true, message: `本班次读数已补录：${Object.keys(patch).join('、')}` }
}

export type NewEvaporationInput = {
  station: string
  date: string
  evaporation: string
  waterTemp?: string
  airTemp?: string
  windSpeed?: string
}

/** 登记新记录：仅记录人可操作，所属班次取当前值班班次。 */
export function createEvaporationEntry(
  input: NewEvaporationInput,
  actor: ActorContext,
): ActionResult {
  if (actor.role === 'outsider') {
    return { ok: false, message: '外站人员只有查看权限，不能登记记录' }
  }
  if (actor.role === 'reviewer') {
    return { ok: false, message: '复核人不能登记原始观测记录' }
  }
  if (!input.station.trim() || !input.date.trim()) {
    return { ok: false, message: '站点编号与观测日期必填' }
  }
  if (!isFiniteReading(input.evaporation) || input.evaporation.trim() === '') {
    return { ok: false, message: '蒸发量必须填写数值' }
  }
  for (const [label, value] of [
    ['水温', input.waterTemp],
    ['气温', input.airTemp],
    ['风速', input.windSpeed],
  ] as const) {
    if (value !== undefined && value.trim() !== '' && !isFiniteReading(value)) {
      return { ok: false, message: `${label}必须是数值` }
    }
  }

  const rows = listRows('evaporation')
  const id = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '已采集',
    pending: true,
    abnormal: false,
    记录编号: `EVAP-${input.date.split('-').join('')}-${String(id).padStart(4, '0')}`,
    站点编号: input.station.trim(),
    观测日期: input.date,
    所属班次: actor.shift === '夜班' ? '夜班 20:00-次日08:00' : '白班 08:00-20:00',
    蒸发量: input.evaporation.trim(),
    水温: input.waterTemp?.trim() ?? '',
    气温: input.airTemp?.trim() ?? '',
    风速: input.windSpeed?.trim() ?? '',
    记录人: actor.name,
    记录状态: '',
  }
  saveRows('evaporation', [...rows, row])
  return { ok: true, message: `蒸发观测记录 ${String(row['记录编号'])} 已登记到${actor.shift}` }
}

/**
 * 整编取数：从蒸发观测中取「已复核通过」且观测年份、站点匹配的记录数，
 * 回填整编成果的「原始记录数」。退回补录、待核、异常记录都不进整编。
 */
export function fetchCompilationSource(compilationId: number): ActionResult {
  const compilation = listRows('compilation')
  const index = compilation.findIndex((row) => Number(row.id) === compilationId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${compilationId} 的整编成果` }
  }
  const target = compilation[index]
  const year = String(target['整编年份'] ?? '').trim()
  const station = String(target['站点编号'] ?? '').trim()
  const approved = listRows('evaporation').filter(
    (row) =>
      String(row.status) === '已通过' &&
      String(row['观测日期'] ?? '').startsWith(year) &&
      String(row['站点编号'] ?? '') === station,
  )
  const updated: EntryRow = { ...target, 原始记录数: String(approved.length) }
  const next = [...compilation]
  next[index] = updated
  saveRows('compilation', next)
  return {
    ok: true,
    message: `整编取数完成：${year} 年 ${station} 已复核通过蒸发记录 ${approved.length} 条，已回填原始记录数`,
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
