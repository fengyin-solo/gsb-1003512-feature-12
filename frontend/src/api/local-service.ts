import { runEvaporationAction } from './evaporation-service'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { createFieldVerifyTodo } from '@/data/field-verify'
import { EVAP_KEY, EVAP_STATUS } from '@/data/evaporation'
import type { ActionContext, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 其他观测模块复核/校核通过后，同样在巡检模块生成一条现场校验待办。
// key=模块key，value 描述哪个动作通过后触发、用哪个字段追溯来源。
const FIELD_VERIFY_TRIGGERS: Record<
  string,
  { action: string; codeField: string; dateField: string; subject: string }
> = {
  waterlevel: { action: '确认通过', codeField: '记录编号', dateField: '观测时间', subject: '核对水位原始观测' },
  discharge: { action: '确认通过', codeField: '记录编号', dateField: '测量时间', subject: '核对流量原始测量' },
  rainfall: { action: '确认通过', codeField: '记录编号', dateField: '观测时段', subject: '核对雨量原始观测' },
  groundwater: { action: '确认通过', codeField: '记录编号', dateField: '观测日期', subject: '核对地下水原始观测' },
  sediment: { action: '确认通过', codeField: '记录编号', dateField: '采样时间', subject: '核对泥沙原始采样' },
  waterquality: { action: '发起复核', codeField: '报告编号', dateField: '采样时间', subject: '核对水质原始检测' },
  crosssection: { action: '确认校核', codeField: '记录编号', dateField: '测量日期', subject: '核对断面原始测量' },
}

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

/** 整编取数：从蒸发观测已通过的记录按年度汇总，旧记录缺班次按观测日期兼容仍可入统。 */
export function compileEvaporation(id: number, meta: ModuleMeta): ActionResult {
  const rows = listRows('compilation')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current !== '整编中') {
    return { ok: false, message: `成果当前为「${current}」，需先开始整编才能取数` }
  }
  const year = String(rows[index]['整编年份'] ?? '').trim()
  if (!/^\d{4}$/.test(year)) {
    return { ok: false, message: '整编年份不是有效年份，无法按年度取数' }
  }
  const approved = listRows(EVAP_KEY).filter((row) => {
    if (String(row.status) !== EVAP_STATUS.approved) {
      return false
    }
    return String(row['观测日期'] ?? '').startsWith(year)
  })
  const updated: EntryRow = {
    ...rows[index],
    原始记录数: approved.length,
    取数来源: `蒸发观测·已通过记录（${year}年）`,
    取数时间: new Date().toLocaleString('zh-CN', { hour12: false }),
  }
  const next = [...rows]
  next[index] = updated
  saveRows('compilation', next)
  return { ok: true, message: `蒸发取数完成：${year}年已通过记录 ${approved.length} 条` }
}

export function runAction(key: string, id: number, action: string, ctx?: ActionContext): ActionResult {
  const meta = moduleMeta(key)

  // 蒸发观测走独立审批流：角色边界、退回清结论、复核通过出现场校验都在里面强制。
  if (key === EVAP_KEY) {
    if (!ctx) {
      return { ok: false, message: '缺少操作身份，无法执行蒸发观测操作' }
    }
    return runEvaporationAction(id, action, ctx)
  }

  // 整编取数：不改变状态，只把已通过的蒸发记录汇总进成果。
  if (key === 'compilation' && action === '蒸发取数') {
    return compileEvaporation(id, meta)
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  // 其他模块复核/校核通过 → 巡检待办生成现场校验。
  const trigger = FIELD_VERIFY_TRIGGERS[key]
  if (trigger && trigger.action === action) {
    const todoId = createFieldVerifyTodo({
      sourceModule: meta.name,
      sourceCode: String(updated[trigger.codeField] ?? ''),
      stationCode: String(updated['站点编号'] ?? updated['采样站点'] ?? ''),
      subject: `${trigger.subject}（${String(updated[trigger.dateField] ?? '')}）`,
    })
    return { ok: true, todoId, message: `${meta.entity}已${action}，当前状态「${target}」，已生成现场校验待办` }
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
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
