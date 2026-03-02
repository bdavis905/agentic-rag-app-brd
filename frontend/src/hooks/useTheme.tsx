import { useEffect, ReactNode } from 'react'

/**
 * Dark mode is always on. ThemeProvider just ensures the class is applied.
 * The toggle and light mode support have been removed for now.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  return <>{children}</>
}
