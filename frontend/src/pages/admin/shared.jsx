import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button, EmptyState, ErrorState, Field } from '../../components/ui'

export function Toolbar({ search, onSearch, placeholder, children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-xs">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-ink-3" aria-hidden />
        <Field aria-label={placeholder} placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} className="[&_input]:pl-9" />
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Pagination({ data, onPage }) {
  if (!data || data.count === 0) return null
  const from = (data.page - 1) * data.page_size + 1
  const to = Math.min(data.count, data.page * data.page_size)
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 text-[13px] text-ink-3">
      <span className="tabular">
        {from}–{to} of {data.count}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="Previous page" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} />
        <span className="tabular px-2">
          Page {data.page} of {data.pages}
        </span>
        <Button size="sm" variant="ghost" icon={ChevronRight} aria-label="Next page" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)} />
      </div>
    </div>
  )
}

/**
 * Responsive data table. `columns`: [{ key, label, className, render(row) }].
 * On small screens rows become stacked cards.
 */
export function DataTable({ list, columns, empty, rowKey = (r) => r.id, onRowClick, canClick = () => true }) {
  const { data, error, loading, reload } = list
  if (loading && !data) {
    return (
      <div className="space-y-px p-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-12" />
        ))}
      </div>
    )
  }
  if (error) return <ErrorState error={error} onRetry={() => reload()} />
  if (!data.results.length) return <EmptyState {...empty} />
  return (
    <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <table className="w-full text-left text-[13.5px]">
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`eyebrow px-4 py-2.5 font-semibold whitespace-nowrap ${c.className || ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.results.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick && canClick(row) ? () => onRowClick(row) : undefined}
              className={`flex flex-col gap-1 px-4 py-3 md:table-row md:p-0 ${onRowClick && canClick(row) ? 'cursor-pointer hover:bg-raised/50' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`md:px-4 md:py-3 ${c.className || ''}`}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Select({ label, value, onChange, options }) {
  return (
    <select aria-label={label} className="input h-9 w-auto py-0 pr-9 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Pill({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'text-ink-2',
    good: 'text-good',
    bad: 'text-bad',
    brass: 'text-brass',
  }
  return (
    <span className={`badge ${tones[tone]}`}>
      <span className="badge-dot" />
      {children}
    </span>
  )
}
