import type { ItemCategory } from './models'

const DEFAULT_AT = '2026-08-21T00:00:00.000Z'
const DEFAULT_DEVICE = 'system-item-defaults-v1'
const seeds = [
  ['数码', '💻', '#6366F1'],
  ['家电', '🔌', '#0EA5E9'],
  ['家居', '🏠', '#F59E0B'],
  ['工具', '🧰', '#64748B'],
  ['服饰', '👕', '#EC4899'],
  ['运动', '🏃', '#10B981'],
  ['其他', '•••', '#8B5CF6'],
] as const

export function createDefaultItemCategories(): ItemCategory[] {
  return seeds.map(([name, icon, color], index) => {
    const counter = index + 1
    return {
      id: `20000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
      name,
      icon,
      color,
      sortOrder: index,
      status: 'active',
      revision: { counter, deviceId: DEFAULT_DEVICE, clock: { [DEFAULT_DEVICE]: counter } },
      createdAt: DEFAULT_AT,
      updatedAt: DEFAULT_AT,
      isSystemDefault: true,
    }
  })
}
