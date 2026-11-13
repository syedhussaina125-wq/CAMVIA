import { useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import type { Student } from '../studentData'
import {
  canPrepareWhatsAppForStudent,
  canUseWhatsAppTemplate,
  createWhatsAppTemplateMessage,
  isWhatsAppTemplateReady,
  normalizeWhatsAppPhone,
  whatsAppTemplates,
  type WhatsAppMessageContext,
  type WhatsAppMessagingUser,
  type WhatsAppTemplate,
} from '../utils/whatsapp'

type WhatsAppComposerProps = {
  student: Student
  user: WhatsAppMessagingUser
  context?: WhatsAppMessageContext
  initialTemplate?: WhatsAppTemplate
  initialMessage?: string
  buttonLabel?: string
}

export function WhatsAppComposer({
  student,
  user,
  context = {},
  initialTemplate = 'General Message',
  initialMessage = '',
  buttonLabel = 'WhatsApp',
}: WhatsAppComposerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [template, setTemplate] = useState<WhatsAppTemplate>(initialTemplate)
  const [message, setMessage] = useState('')
  const [prepared, setPrepared] = useState(false)

  if (!canPrepareWhatsAppForStudent(user, student)) return null

  const allowedTemplates = whatsAppTemplates.filter((item) => canUseWhatsAppTemplate(user, item, context))
  if (allowedTemplates.length === 0) return null

  const openComposer = () => {
    const readyTemplates = allowedTemplates.filter((item) => isWhatsAppTemplateReady(item, context))
    const selectedTemplate = readyTemplates.includes(initialTemplate)
      ? initialTemplate
      : readyTemplates[0] ?? allowedTemplates[0]
    if (!selectedTemplate) return
    setTemplate(selectedTemplate)
    setMessage(selectedTemplate === 'Custom Message' ? initialMessage : createWhatsAppTemplateMessage(selectedTemplate, student, context))
    setPrepared(false)
    setIsOpen(true)
  }

  const phone = normalizeWhatsAppPhone(student.guardian.phone)
  const whatsAppUrl = phone && message.trim()
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message.trim())}`
    : ''

  return (
    <>
      <button type="button" className="secondary-button small-button whatsapp-open-button" onClick={openComposer}>
        <MessageCircle size={16} /> {buttonLabel}
      </button>
      {isOpen ? (
        <div className="whatsapp-modal-backdrop" role="presentation">
          <section className="whatsapp-modal" role="dialog" aria-modal="true" aria-labelledby="whatsapp-title">
            <header className="whatsapp-modal-heading">
              <div>
                <p className="eyebrow">No API · Manual send</p>
                <h2 id="whatsapp-title">Prepare WhatsApp message</h2>
                <p>{student.guardian.name || 'Guardian'} · {student.firstName} {student.lastName}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close WhatsApp composer" onClick={() => setIsOpen(false)}><X size={18} /></button>
            </header>

            <label className="whatsapp-field">
              Template
              <select value={template} onChange={(event) => {
                const nextTemplate = event.target.value as WhatsAppTemplate
                setTemplate(nextTemplate)
                setMessage(nextTemplate === 'Custom Message' && template === 'Custom Message'
                  ? message
                  : nextTemplate === 'Custom Message'
                    ? initialMessage
                    : createWhatsAppTemplateMessage(nextTemplate, student, context))
                setPrepared(false)
              }}>
                {allowedTemplates.map((item) => (
                  <option key={item} value={item} disabled={!isWhatsAppTemplateReady(item, context)}>
                    {item}{!isWhatsAppTemplateReady(item, context) ? ' — no matching recorded data' : ''}
                  </option>
                ))}
              </select>
            </label>

            {template === 'Fee Reminder' && context.fee ? (
              <p className="whatsapp-context-note">
                Outstanding: PKR {new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(context.fee.outstandingAmount)}
                {' · '}Due {context.fee.dueDate}
              </p>
            ) : null}
            {template === 'Low Attendance' && context.attendance ? (
              <p className="whatsapp-context-note">
                Based on {context.attendance.recordedDays} recorded attendance days · {context.attendance.rate ?? '—'}%
              </p>
            ) : null}

            <label className="whatsapp-field">
              Message
              <textarea rows={8} value={message} onChange={(event) => { setMessage(event.target.value); setPrepared(false) }} />
            </label>

            <p className="whatsapp-safety-note">
              {phone
                ? `Opens WhatsApp for ${student.guardian.phone}. Review the draft and press Send there. CAMVIA cannot confirm delivery.`
                : 'No valid guardian phone number is available. Update the guardian contact in Student 360 first.'}
            </p>
            {prepared ? <p className="whatsapp-prepared-note" role="status">WhatsApp draft prepared. It has not been sent.</p> : null}
            <footer className="whatsapp-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Cancel</button>
              {whatsAppUrl ? (
                <a
                  className="primary-button whatsapp-link-button"
                  href={whatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setPrepared(true)}
                >
                  <MessageCircle size={16} /> Open WhatsApp
                </a>
              ) : (
                <button type="button" className="primary-button" disabled>
                  <MessageCircle size={16} /> Open WhatsApp
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
