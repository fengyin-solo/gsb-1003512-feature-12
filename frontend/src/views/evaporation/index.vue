<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">记录人只补录本班次蒸发量与环境读数；复核人可通过、退回、标记异常但不能改原始值；外站人员仅查看。环境三项缺测提交进「待核」。</p>
      </div>
      <div class="page-actions">
        <button v-if="store.role === 'observer'" class="btn primary" type="button" @click="openCreate">登记蒸发观测记录</button>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <p class="role-banner" :class="{ readonly: store.role === 'outsider' }">
      当前身份：{{ store.roleLabel }}（{{ store.operator }}）
      <template v-if="store.role === 'observer'">· 值班班次：{{ store.shift }}，只能补录/提交本班次记录</template>
      <template v-else-if="store.role === 'reviewer'">· 可复核通过、退回补录、标记异常；原始读数只读</template>
      <template v-else>· 仅可查看，任何提交、补录、复核都会被拒绝</template>
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>操作（按职责开放）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '所属班次'">
              {{ rowShift(row).shift }}
              <span v-if="rowShift(row).legacy" class="tag-legacy" title="旧记录无所属班次，按观测日期兼容到白班">旧记录兼容</span>
            </template>
            <template v-else>{{ display(row, column) }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="store.role === 'observer'">
              <button
                class="link"
                type="button"
                :disabled="!sameShift(row) || row.status === '已通过'"
                :title="sameShift(row) ? '补录本班次蒸发量与环境读数' : '不能补录别班记录'"
                @click="openBackfill(row)"
              >
                补录读数
              </button>
              <button
                class="link"
                type="button"
                :disabled="!sameShift(row)"
                :title="sameShift(row) ? '提交本班次记录审核' : '不能越班提交'"
                @click="runAction('提交审核', row)"
              >
                提交审核
              </button>
            </template>
            <template v-else-if="store.role === 'reviewer'">
              <button class="link" type="button" @click="runAction('确认通过', row)">确认通过</button>
              <button class="link" type="button" @click="runAction('退回补录', row)">退回补录</button>
              <button class="link" type="button" @click="runAction('标记异常', row)">标记异常</button>
            </template>
            <span v-else class="tag-legacy">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无蒸发观测数据，可先登记蒸发观测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条蒸发观测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="formOpen" class="modal-mask" @click.self="formOpen = false">
      <form class="modal-card" @submit.prevent="submitForm">
        <h3>{{ formMode === 'create' ? '登记蒸发观测记录' : `补录读数 · ${String(editing?.['记录编号'] ?? '')}` }}</h3>
        <div class="form-grid">
          <label v-if="formMode === 'create'">
            <span>站点编号</span>
            <input v-model="form.station" placeholder="如 EVAP-01" required />
          </label>
          <label v-if="formMode === 'create'">
            <span>观测日期</span>
            <input v-model="form.date" type="date" required />
          </label>
          <label>
            <span>蒸发量(mm)</span>
            <input v-model="form.evaporation" inputmode="decimal" placeholder="本班次蒸发量" />
          </label>
          <label>
            <span>水温(℃)</span>
            <input v-model="form.waterTemp" inputmode="decimal" placeholder="缺测可留空，进待核" />
          </label>
          <label>
            <span>气温(℃)</span>
            <input v-model="form.airTemp" inputmode="decimal" placeholder="缺测可留空，进待核" />
          </label>
          <label>
            <span>风速(m/s)</span>
            <input v-model="form.windSpeed" inputmode="decimal" placeholder="缺测可留空，进待核" />
          </label>
        </div>
        <p v-if="formMode === 'backfill'" class="page-desc">仅可补录本班次蒸发量与环境读数；留空项保持原样，原始值由记录人负责，复核人不可改。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="formOpen = false">取消</button>
          <button class="btn primary" type="submit">{{ formMode === 'create' ? '登记' : '保存补录' }}</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  backfillEntry,
  createEvaporationEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { resolveShift } from '@/domain/evaporation'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('evaporation')
const columns = ['记录编号', '站点编号', '观测日期', '所属班次', '蒸发量', '水温', '气温', '风速', '记录人', '复核人']
const statuses = ['已采集', '待审核', '待核', '已通过', '异常值', '退回补录']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['记录编号', '站点编号', '观测日期']

const today = new Date().toISOString().slice(0, 10)
const stats = computed(() => [
  { label: '今日观测站次', value: rows.value.filter((row) => String(row['观测日期']) === today).length },
  { label: '待审核记录', value: rows.value.filter((row) => ['待审核', '待核'].includes(String(row.status))).length },
  { label: '待核记录', value: rows.value.filter((row) => String(row.status) === '待核').length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function rowShift(row: EntryRow) {
  return resolveShift(row)
}
function sameShift(row: EntryRow): boolean {
  return resolveShift(row).shift === store.shift
}
function display(row: EntryRow, column: string): string {
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

const formOpen = ref(false)
const formMode = ref<'create' | 'backfill'>('create')
const editing = ref<EntryRow | null>(null)
const form = reactive({ station: '', date: today, evaporation: '', waterTemp: '', airTemp: '', windSpeed: '' })

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  formMode.value = 'create'
  editing.value = null
  Object.assign(form, { station: '', date: today, evaporation: '', waterTemp: '', airTemp: '', windSpeed: '' })
  formOpen.value = true
}

function openBackfill(row: EntryRow) {
  formMode.value = 'backfill'
  editing.value = row
  Object.assign(form, {
    station: String(row['站点编号'] ?? ''),
    date: String(row['观测日期'] ?? ''),
    evaporation: String(row['蒸发量'] ?? ''),
    waterTemp: String(row['水温'] ?? ''),
    airTemp: String(row['气温'] ?? ''),
    windSpeed: String(row['风速'] ?? ''),
  })
  formOpen.value = true
}

function submitForm() {
  errorMessage.value = ''
  const result =
    formMode.value === 'create'
      ? createEvaporationEntry(
          {
            station: form.station,
            date: form.date,
            evaporation: form.evaporation,
            waterTemp: form.waterTemp,
            airTemp: form.airTemp,
            windSpeed: form.windSpeed,
          },
          store.actor,
        )
      : backfillEntry(
          Number(editing.value?.id),
          {
            蒸发量: form.evaporation,
            水温: form.waterTemp,
            气温: form.airTemp,
            风速: form.windSpeed,
          },
          store.actor,
        )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  formOpen.value = false
  errorMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.actor)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '蒸发观测列表读取失败'
  }
}

onMounted(reload)
</script>
