import { defineStore } from 'pinia'

import { DAY_SHIFT, type OperatorRole, type ShiftKind } from '@/data/types'

// 当前值班身份。蒸发观测按角色分权：记录人/复核人/外站人员，外站只读。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: 'recorder' as OperatorRole,
    shiftLabel: DAY_SHIFT,
    shift: 'day' as ShiftKind,
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
      this.shift = label.includes('夜') ? 'night' : 'day'
    },
    setRole(role: OperatorRole) {
      this.role = role
    },
    toggleShift() {
      if (this.shift === 'day') {
        this.setShift('夜班 20:00-08:00')
      } else {
        this.setShift(DAY_SHIFT)
      }
    },
  },
})
