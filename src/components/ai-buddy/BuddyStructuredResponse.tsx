import { useState } from 'react'
import { Download, Printer, ExternalLink, Check, Copy, AlertCircle, Info, CheckCircle2 } from 'lucide-react'
import type { AskCamviaComponent, AskCamviaExportData } from '../../services/askCamvia'
import { exportToCsv, exportToHtmlPrint } from '../../services/buddyExport'

type Props = {
  component?: AskCamviaComponent
  exportData?: AskCamviaExportData
  onActionClick?: (actionType: string, target: string) => void
}

export function BuddyStructuredResponse({ component, exportData, onActionClick }: Props) {
  const [copied, setCopied] = useState(false)

  if (!component && !exportData) return null

  const handleCopyTable = (table: NonNullable<AskCamviaComponent['table']>) => {
    const header = table.columns.map((c) => c.header).join('\t')
    const rows = table.rows
      .map((r) => table.columns.map((c) => String(r[c.key] ?? '')).join('\t'))
      .join('\n')
    navigator.clipboard.writeText(`${header}\n${rows}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="buddy-structured-container">
      {/* KPI Cards */}
      {component?.kpis && component.kpis.length > 0 ? (
        <div className="buddy-kpi-grid">
          {component.kpis.map((kpi, idx) => (
            <div key={idx} className={`buddy-kpi-card ${kpi.color || 'primary'}`}>
              <span className="buddy-kpi-label">{kpi.label}</span>
              <strong className="buddy-kpi-val">{kpi.value}</strong>
              {kpi.subtext ? <span className="buddy-kpi-sub">{kpi.subtext}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Alert Component */}
      {component?.alert ? (
        <div className={`buddy-alert-banner ${component.alert.type}`}>
          {component.alert.type === 'error' || component.alert.type === 'warning' ? (
            <AlertCircle size={15} />
          ) : component.alert.type === 'success' ? (
            <CheckCircle2 size={15} />
          ) : (
            <Info size={15} />
          )}
          <span>{component.alert.message}</span>
        </div>
      ) : null}

      {/* Interactive Table */}
      {component?.table ? (
        <div className="buddy-table-wrapper">
          {component.table.caption ? (
            <div className="buddy-table-header">
              <span>{component.table.caption}</span>
              <button
                type="button"
                className="buddy-mini-btn"
                onClick={() => handleCopyTable(component.table!)}
                title="Copy table to clipboard"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          ) : null}
          <div className="buddy-table-scroll">
            <table className="buddy-data-table">
              <thead>
                <tr>
                  {component.table.columns.map((col) => (
                    <th key={col.key} style={{ textAlign: col.align || 'left' }}>
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {component.table.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {component.table!.columns.map((col) => (
                      <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                        {String(row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {component.table.total && component.table.total > component.table.rows.length ? (
            <div className="buddy-table-footer">
              Showing {component.table.rows.length} of {component.table.total} records
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Action Buttons */}
      {component?.actions && component.actions.length > 0 ? (
        <div className="buddy-actions-row">
          {component.actions.map((action, idx) => (
            <button
              key={idx}
              type="button"
              className={`buddy-action-btn ${action.variant || 'secondary'}`}
              onClick={() => onActionClick?.(action.actionType, action.target)}
            >
              <span>{action.label}</span>
              {action.actionType === 'navigate' ? <ExternalLink size={12} /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Export Controls */}
      {exportData ? (
        <div className="buddy-export-card">
          <div className="buddy-export-meta">
            <strong>{exportData.title}</strong>
            <span>{exportData.rows.length} records ready for download</span>
          </div>
          <div className="buddy-export-buttons">
            <button
              type="button"
              className="buddy-export-btn"
              onClick={() => exportToCsv(exportData)}
            >
              <Download size={13} />
              <span>CSV</span>
            </button>
            <button
              type="button"
              className="buddy-export-btn"
              onClick={() => exportToHtmlPrint(exportData)}
            >
              <Printer size={13} />
              <span>Print / PDF</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
