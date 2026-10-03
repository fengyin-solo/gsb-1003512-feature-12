import { defineStore } from 'pinia'

import { ROLE_LABEL, type ActorContext, type RoleKey } from '@/domain/authorization'
import { normalizeShift, type Shift } from '@/domain/evaporation'

export const SHIFT_LABEL: Record<Shift, string> = {
  白班: '白班 08:00-20:00',
  夜班: '夜班 20:00-次日08:00',
}

const ROLE_NAMES: Record<RoleKey, string> = {
  observer: '王观测',
  reviewer: '陈复核',
  outsider: '外站访客',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    role: 'observer' as RoleKey,
    operator: ROLE_NAMES.observer,
    shift: '白班' as Shift,
    shiftLabel: SHIFT_LABEL['白班'],
    scope: '水文监测站网管理系统',
  }),
  getters: {
    roleLabel: (state) => ROLE_LABEL[state.role],
    canOperate: (state) => state.role !== 'outsider',
    actor(state): ActorContext {
      return { role: state.role, shift: state.shift, name: state.operator }
    },
  },
  actions: {
    setRole(role: RoleKey) {
      this.role = role
      this.operator = ROLE_NAMES[role]
    },
    setShift(label: string) {
      this.shiftLabel = label
      this.shift = normalizeShift(label)
    },
  },
})
