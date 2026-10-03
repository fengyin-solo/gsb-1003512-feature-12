<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">
          记录人补录本班次蒸发量与环境读数并提交；复核人可退回（不改原始值）或确认通过；外站人员只读。
          气温、水温、风速缺一项进入待核；旧记录缺所属班次按观测日期兼容。
        </p>
      </div>
      <div class="page-actions">
        <button
          v-if="store.role === 'recorder'"
          class="btn primary"
          type="button"
          @click="openCreate"
        >登记本班次蒸发观测</button>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <div class="role-banner" :class="`role-${store.role}`">
      <span>当前身份：<strong>{{ roleLabel }}</strong></span>
      <span>当前班次：{{ store.shiftLabel }}</span>
      <button class="btn" type="button" @click="store.toggleShift()">切换班次</button>
      <label class="role-switch">
        切换身份
        <select :value="store.role" @change="onRoleChange">
          <option v-for="r in ROLE_ORDER" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
        </select>
      </label>
      <span class="role-hint">{{ roleHint }}</span>
    </div>

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
          <th>复核中间结论</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
          <td>
            {{ row.status }}
            <span v-if="shiftInfo(row).inferred" class="compat-tag" title="旧记录无所属班次，按观测日期兼容为白班">班次兼容</span>
          </td>
          <td>{{ String(row[reviewNote] ?? '') || '—' }}</td>
          <td class="row-actions">
            <template v-if="store.role !== 'external'">
              <button
                v-for="action in availableActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button
                v-if="canSupplement(row)"
                class="link"
                type="button"
                @click="openSupplement(row)"
              >补录</button>
              <span v-if="!availableActions(row).length && !canSupplement(row)" class="muted-text">无</span>
            </template>
            <span v-else class="muted-text">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无蒸发观测数据</td>
        </tr>
      </tbody>
    </table>

    <!-- 补录弹层：记录人只能改蒸发量与三项环境读数 -->
    <div v-if="supplement.open" class="modal-mask" @click.self="closeSupplement">
      <div class="modal">
        <h3>{{ supplement.mode === 'create' ? '登记本班次蒸发观测' : '补录蒸发观测' }}</h3>
        <p v-if="supplement.mode === 'edit'" class="modal-sub">
          {{ String(supplement.row?.['记录编号'] ?? '') }} · 仅可填写蒸发量与环境读数，其余原始值不可改动
        </p>
        <div class="form-grid">
          <label v-if="supplement.mode === 'create'">
            <span>站点编号</span>
            <input v-model="supplement.form.stationCode" placeholder="如 EVAP-0007" />
          </label>
          <label v-if="supplement.mode === 'create'">
            <span>观测日期</span>
            <input v-model="supplement.form.date" type="date" />
          </label>
          <label v-else>
            <span>所属班次</span>
            <input :value="store.shiftLabel" disabled />
          </label>
          <label>
            <span>蒸发量(mm)</span>
            <input v-model="supplement.form.amount" inputmode="decimal" placeholder="必填" />
          </label>
          <label>
            <span>水温(℃)</span>
            <input v-model="supplement.form.waterTemp" inputmode="decimal" placeholder="缺项将进待核" />
          </label>
          <label>
            <span>气温(℃)</span>
            <input v-model="supplement.form.airTemp" inputmode="decimal" placeholder="缺项将进待核" />
          </label>
          <label>
            <span>风速(m/s)</span>
            <input v-model="supplement.form.windSpeed" inputmode="decimal" placeholder="缺项将进待核" />
          </label>
        </div>
        <p v-if="supplement.error" class="error-text">{{ supplement.error }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeSupplement">取消</button>
          <button class="btn primary" type="button" @click="submitSupplement">保存</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条蒸发观测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createEntry,
  supplementReading,
} from '@/api/evaporation-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { REVIEW_NOTE, resolveShift } from '@/data/evaporation'
import {
  ROLE_LABELS,
  ROLE_ORDER,
  type ActionContext,
  type EntryRow,
  type OperatorRole,
} from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('evaporation')
const columns = ["记录编号", "站点编号", "观测日期", "所属班次", "蒸发量", "水温", "气温", "风速", "记录人"]
const reviewNote = REVIEW_NOTE
const statuses = ["已采集", "待审核", "待核", "已退回", "已通过", "异常值"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["记录编号", "站点编号", "观测日期"]

const roleLabel = computed(() => ROLE_LABELS[store.role])
const roleHint = computed(() => {
  if (store.role === 'recorder') {
    return '可补录/登记本班次蒸发量与环境读数并提交审核'
  }
  if (store.role === 'reviewer') {
    return '可退回或确认通过，不能修改原始值'
  }
  return '仅可查看，不能登记、补录、提交或复核'
})

const stats = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return [
    { label: '今日观测站次', value: rows.value.filter((r) => String(r['观测日期']) === today).length },
    { label: '待审核记录', value: rows.value.filter((r) => r.status === '待审核' || r.status === '待核').length },
    { label: '待核记录', value: rows.value.filter((r) => r.status === '待核').length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const supplement = reactive({
  open: false,
  mode: 'create' as 'create' | 'edit',
  row: null as EntryRow | null,
  error: '',
  form: { stationCode: '', date: '', amount: '', waterTemp: '', airTemp: '', windSpeed: '' },
})

function onRoleChange(event: Event) {
  store.setRole((event.target as HTMLSelectElement).value as OperatorRole)
}

function shiftInfo(row: EntryRow) {
  return resolveShift(row)
}

function display(row: EntryRow, column: string): string {
  if (column === '所属班次') {
    const raw = String(row[column] ?? '').trim()
    if (raw !== '') {
      return raw
    }
    // 旧记录缺所属班次：按观测日期兼容为白班，仅展示兼容结果。
    return `${resolveShift(row).label}（兼容）`
  }
  if (column === '水温' || column === '气温' || column === '风速') {
    const value = String(row[column] ?? '').trim()
    return value === '' ? '缺' : value
  }
  return String(row[column] ?? '—') || '—'
}

function isOwnShift(row: EntryRow): boolean {
  return resolveShift(row).shift === store.shift
}

function canSupplement(row: EntryRow): boolean {
  if (store.role !== 'recorder' || !isOwnShift(row)) {
    return false
  }
  return ['已采集', '已退回'].includes(String(row.status))
}

function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (store.role === 'recorder') {
    if (!isOwnShift(row)) {
      return []
    }
    return ['已采集', '已退回'].includes(status) ? ['提交审核'] : []
  }
  if (store.role === 'reviewer') {
    if (['待审核', '待核'].includes(status)) {
      return ['确认通过', '退回']
    }
    if (!['已通过', '异常值'].includes(status)) {
      return ['标记异常']
    }
    return []
  }
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  if (store.role !== 'recorder') {
    errorMessage.value = '只有记录人可以登记蒸发观测记录'
    return
  }
  const today = new Date().toISOString().slice(0, 10)
  supplement.mode = 'create'
  supplement.row = null
  supplement.error = ''
  supplement.form = { stationCode: '', date: today, amount: '', waterTemp: '', airTemp: '', windSpeed: '' }
  supplement.open = true
}

function openSupplement(row: EntryRow) {
  supplement.mode = 'edit'
  supplement.row = row
  supplement.error = ''
  supplement.form = {
    stationCode: String(row['站点编号'] ?? ''),
    date: String(row['观测日期'] ?? ''),
    amount: String(row['蒸发量'] ?? ''),
    waterTemp: String(row['水温'] ?? ''),
    airTemp: String(row['气温'] ?? ''),
    windSpeed: String(row['风速'] ?? ''),
  }
  supplement.open = true
}

function closeSupplement() {
  supplement.open = false
}

function actionContext(): ActionContext {
  return { role: store.role, shift: store.shift }
}

function submitSupplement() {
  successMessage.value = ''
  const values = {
    蒸发量: supplement.form.amount,
    水温: supplement.form.waterTemp,
    气温: supplement.form.airTemp,
    风速: supplement.form.windSpeed,
  }
  const result =
    supplement.mode === 'create'
      ? createEntry(
          {
            stationCode: supplement.form.stationCode,
            date: supplement.form.date,
            amount: supplement.form.amount,
            waterTemp: supplement.form.waterTemp,
            airTemp: supplement.form.airTemp,
            windSpeed: supplement.form.windSpeed,
          },
          actionContext(),
          store.operator,
        )
      : supplementReading(Number(supplement.row?.id), values, actionContext())
  if (!result.ok) {
    supplement.error = result.message
    return
  }
  supplement.open = false
  successMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  // 越权提交由数据层拒绝，这里也提前拦一道，避免误操作。
  if (store.role === 'external') {
    errorMessage.value = '外站人员只有查看权限'
    return
  }
  const result = applyAction(meta.key, Number(row.id), action, actionContext())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
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
