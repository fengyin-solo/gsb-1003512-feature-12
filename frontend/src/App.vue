<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水文监测站网管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。</span>
        <span class="head-user">
          <label class="role-switch">
            角色
            <select :value="store.role" @change="onRoleChange">
              <option value="observer">记录人（本班次）</option>
              <option value="reviewer">复核人</option>
              <option value="outsider">外站人员（只查看）</option>
            </select>
          </label>
          <label v-if="store.role === 'observer'" class="role-switch">
            班次
            <select :value="store.shift" @change="onShiftChange">
              <option value="白班">白班</option>
              <option value="夜班">夜班</option>
            </select>
          </label>
          当前值班：{{ store.operator }}（{{ store.roleLabel }}） · {{ store.shiftLabel }}
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore, SHIFT_LABEL } from '@/stores/session'
import type { RoleKey } from '@/domain/authorization'

const store = useSessionStore()

function onRoleChange(event: Event) {
  store.setRole((event.target as HTMLSelectElement).value as RoleKey)
}

function onShiftChange(event: Event) {
  const shift = (event.target as HTMLSelectElement).value as '白班' | '夜班'
  store.setShift(SHIFT_LABEL[shift])
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "监测站点", path: "/station" }, { label: "水位监测", path: "/waterlevel" }, { label: "流量监测", path: "/discharge" }, { label: "雨量观测", path: "/rainfall" }, { label: "水质检测", path: "/waterquality" }, { label: "断面测量", path: "/crosssection" }, { label: "遥测设备", path: "/telemetry" }, { label: "数据整编", path: "/compilation" }, { label: "预警阈值", path: "/warning" }, { label: "地下水观测", path: "/groundwater" }, { label: "蒸发观测", path: "/evaporation" }, { label: "测流缆道", path: "/cableway" }, { label: "泥沙监测", path: "/sediment" }, { label: "通讯系统", path: "/communication" }, { label: "站房维护", path: "/stationhouse" }, { label: "仪器检定", path: "/calibration" }, { label: "巡检记录", path: "/inspection" }, { label: "测报方案", path: "/plan" }]
</script>
