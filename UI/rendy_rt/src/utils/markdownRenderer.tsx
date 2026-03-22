import type { ReactNode } from 'react'

const matchesFakeMarker = (value: string | null | undefined) =>
  typeof value === 'string' && value.trim().toUpperCase() === 'TEXT'

const shouldHideNode = (node: ReactNode): boolean => {
  if (!node) return false
  if (typeof node === 'string') return matchesFakeMarker(node)
  if (Array.isArray(node)) return node.every((child) => shouldHideNode(child))
  return false
}

export const filterFakeTextBlocks = (children: ReactNode[]): ReactNode[] =>
  children.filter((child) => !shouldHideNode(child))
