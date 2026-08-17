import type { Category, Transaction, TransactionType } from './models'

interface CategorySeed {
  name: string
  icon: string
  color: string
  children?: string[]
}

const DEFAULT_GENESIS_AT = '2026-08-14T00:00:00.000Z'
const DEFAULT_GENESIS_DEVICE = 'system-defaults-v1'

const expenseSeeds: CategorySeed[] = [
  { name: '餐饮', icon: '🍜', color: '#F97316', children: ['早餐', '正餐', '外卖', '零食饮料'] },
  { name: '生活缴费', icon: '💡', color: '#EAB308', children: ['水费', '电费', '燃气费', '手机话费', '宽带', '物业费'] },
  { name: '交通出行', icon: '🚇', color: '#0EA5E9', children: ['公交地铁', '打车', '油费', '停车养车'] },
  { name: '购物', icon: '🛍️', color: '#EC4899', children: ['日用品', '服饰', '数码', '美妆'] },
  { name: '居住', icon: '🏠', color: '#8B5CF6', children: ['房租房贷', '家具家电', '维修'] },
  { name: '医疗健康', icon: '💊', color: '#10B981', children: ['药品', '门诊', '体检', '健身'] },
  { name: '娱乐休闲', icon: '🎮', color: '#6366F1', children: ['影音', '游戏', '聚会', '旅行'] },
  { name: '学习', icon: '📚', color: '#14B8A6', children: ['图书', '课程', '考试'] },
  { name: '人情往来', icon: '🎁', color: '#F43F5E', children: ['红包', '礼物', '孝亲'] },
  { name: '其他', icon: '•••', color: '#64748B' },
]

const incomeSeeds: CategorySeed[] = [
  { name: '工资', icon: '💼', color: '#16A34A' },
  { name: '奖金', icon: '🏆', color: '#22C55E' },
  { name: '副业', icon: '🧩', color: '#0D9488' },
  { name: '报销', icon: '🧾', color: '#0284C7' },
  { name: '理财收益', icon: '📈', color: '#7C3AED' },
  { name: '红包礼金', icon: '🧧', color: '#E11D48' },
  { name: '退款', icon: '↩️', color: '#D97706' },
  { name: '其他', icon: '•••', color: '#64748B' },
]

function defaultId(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

export function createDefaultCategories(_now: string, _deviceId: string): Category[] {
  let idCounter = 1
  let revisionCounter = 1
  const categories: Category[] = []

  const addSeeds = (type: TransactionType, seeds: CategorySeed[]) => {
    seeds.forEach((seed, rootIndex) => {
      const rootId = defaultId(idCounter++)
      categories.push({
        id: rootId,
        type,
        parentId: null,
        name: seed.name,
        icon: seed.icon,
        color: seed.color,
        sortOrder: rootIndex,
        isPinned: type === 'expense' && rootIndex < 6,
        status: 'active',
        revision: {
          counter: revisionCounter,
          deviceId: DEFAULT_GENESIS_DEVICE,
          clock: { [DEFAULT_GENESIS_DEVICE]: revisionCounter++ },
        },
        createdAt: DEFAULT_GENESIS_AT,
        updatedAt: DEFAULT_GENESIS_AT,
        isSystemDefault: true,
      })

      seed.children?.forEach((name, childIndex) => {
        categories.push({
          id: defaultId(idCounter++),
          type,
          parentId: rootId,
          name,
          icon: seed.icon,
          color: seed.color,
          sortOrder: childIndex,
          isPinned: false,
          status: 'active',
          revision: {
            counter: revisionCounter,
            deviceId: DEFAULT_GENESIS_DEVICE,
            clock: { [DEFAULT_GENESIS_DEVICE]: revisionCounter++ },
          },
          createdAt: DEFAULT_GENESIS_AT,
          updatedAt: DEFAULT_GENESIS_AT,
          isSystemDefault: true,
        })
      })
    })
  }

  addSeeds('expense', expenseSeeds)
  addSeeds('income', incomeSeeds)
  return categories
}

export function normalizeLegacyDefaultCategories(categories: Category[]): Category[] {
  const canonical = new Map(createDefaultCategories(DEFAULT_GENESIS_AT, DEFAULT_GENESIS_DEVICE).map((item) => [item.id, item]))
  const unchangedFields: Array<keyof Category> = [
    'id', 'type', 'parentId', 'name', 'icon', 'color', 'sortOrder', 'isPinned', 'status', 'isSystemDefault',
  ]
  return categories.map((item) => {
    const expected = canonical.get(item.id)
    if (
      !expected ||
      item.deletedAt ||
      unchangedFields.some((field) => item[field] !== expected[field])
    ) return item
    return JSON.stringify(item) === JSON.stringify(expected) ? item : expected
  })
}

export function validateCategorySelection(
  categories: Category[],
  type: TransactionType,
  categoryId: string,
  subcategoryId: string | null,
): void {
  const root = categories.find((item) => item.id === categoryId && !item.deletedAt)
  if (!root || root.parentId !== null || root.type !== type) {
    throw new Error('请选择有效的大类')
  }
  if (root.status !== 'active') {
    throw new Error('该分类已归档')
  }
  if (!subcategoryId) return

  const child = categories.find((item) => item.id === subcategoryId && !item.deletedAt)
  if (!child || child.parentId !== categoryId || child.type !== type) {
    throw new Error('二级分类不属于所选大类')
  }
  if (child.status !== 'active') {
    throw new Error('该分类已归档')
  }
}

export function categoryRemovalPolicy(categoryId: string, transactions: Transaction[]): 'delete' | 'archive' {
  const referenced = transactions.some(
    (transaction) => transaction.categoryId === categoryId || transaction.subcategoryId === categoryId,
  )
  return referenced ? 'archive' : 'delete'
}

export function getSubcategoryMoveImpact(subcategoryId: string, transactions: Transaction[]): number {
  return transactions.filter((transaction) => !transaction.deletedAt && transaction.subcategoryId === subcategoryId).length
}

export function moveSubcategory(
  categories: Category[],
  subcategoryId: string,
  newParentId: string,
  transactions: Transaction[],
  confirmed: boolean,
  now: string,
): Category[] {
  const child = categories.find((item) => item.id === subcategoryId && !item.deletedAt)
  const parent = categories.find((item) => item.id === newParentId && !item.deletedAt)
  if (!child || child.parentId === null) throw new Error('请选择有效的二级分类')
  if (!parent || parent.parentId !== null || parent.type !== child.type || parent.status !== 'active') {
    throw new Error('请选择同类型的有效大类')
  }

  const impact = getSubcategoryMoveImpact(subcategoryId, transactions)
  if (impact > 0 && !confirmed) {
    throw new Error(`移动会影响 ${impact} 笔历史流水`)
  }

  return categories.map((item) =>
    item.id === subcategoryId
      ? {
          ...item,
          parentId: newParentId,
          updatedAt: now,
          revision: {
            counter: item.revision.counter + 1,
            deviceId: item.revision.deviceId,
            clock: {
              ...(item.revision.clock ?? {}),
              [item.revision.deviceId]: item.revision.counter + 1,
            },
          },
        }
      : item,
  )
}
