import { ArrowRight, Bot, Sparkles, Copy, Check, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BuddyStructuredResponse } from './components/ai-buddy/BuddyStructuredResponse'
import { useAskCamviaChat } from './components/ai-buddy/useAskCamviaChat'
import { getAskCamviaSuggestions } from './components/ai-buddy/promptSuggestions'

export function AskEduPage() {
  const { user, query, setQuery, generating, messages, submitPrompt, clearMessages, retryLastPrompt } = useAskCamviaChat()
  const navigate = useNavigate()
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(idx)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  const handleAction = (type: string, target: string) => {
    if (type === 'navigate') navigate(target)
    else if (type === 'prompt') submitPrompt(target)
  }
  if (!user) return null
  const suggestionCards = getAskCamviaSuggestions(user.role)

  return (
    <section className="ask-edu-page">
      <div className="panel-header flex-header">
        <div>
          <h1>Ask CAMVIA</h1>
          <p className="student-muted">Ask questions and analyze performance across your authorized scope.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="ghost-button" onClick={clearMessages} disabled={generating} style={{ fontSize: '12px', padding: '4px 10px' }}>
            <RotateCcw size={12} /> Clear Chat
          </button>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="ghost-button" onClick={clearMessages} disabled={generating} style={{ fontSize: '12px', padding: '4px 10px' }}>
            <RotateCcw size={12} /> Clear Chat
          </button>
          <button type="button" className="ghost-button" onClick={retryLastPrompt} disabled={generating} style={{ fontSize: '12px', padding: '4px 10px' }}>
            Retry
          </button>
          <div className="status-pill updated-pill">Role-scoped live data</div>
        </div>
        </div>
      </div>

      <div className="ask-edu-container">
        {/* Suggested Prompt Chips */}
        <div className="ask-edu-prompts-section">
          <div className="ask-edu-prompts-header">
            <Sparkles size={16} className="text-blue" />
            <span>Suggested questions for your scope:</span>
          </div>
          <div className="ask-edu-prompts-grid">
            {suggestionCards.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="ask-edu-prompt-card"
                onClick={() => submitPrompt(suggestion)}
                disabled={generating}
              >
                <Sparkles size={13} className="prompt-sparkle-icon" />
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Premium AI Chat Panel */}
        <div className="ask-edu-panel">
          <div className="ask-edu-header">
            <div className="ask-edu-assistant-info">
              <div className="ask-edu-avatar">
                <Bot size={18} />
              </div>
              <div>
                <strong>CAMVIA Intelligence Assistant</strong>
                <span>Scope: {user.schoolName} · {user.role.toUpperCase()}</span>
              </div>
            </div>
            <span className="status-pill success">Live Assistant</span>
          </div>

          <div className="ask-edu-messages">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`ask-edu-message-row ${message.role}`}>
                {message.role === 'assistant' && (
                  <div className="message-avatar assistant">
                    <Bot size={16} />
                  </div>
                )}
                <div className={`ask-edu-bubble ${message.role}`}>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{message.text}</p>
                  {message.role === 'assistant' ? (
                    <>
                      <BuddyStructuredResponse
                        component={message.component}
                        exportData={message.exportData}
                        onActionClick={handleAction}
                      />
                      <div className="buddy-bubble-actions" style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="buddy-action-icon-btn"
                          onClick={() => handleCopy(message.text, index)}
                          title="Copy text"
                        >
                          {copiedIndex === index ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
            {generating && (
              <div className="ask-edu-message-row assistant">
                <div className="message-avatar assistant">
                  <Bot size={16} />
                </div>
                <div className="ask-edu-bubble assistant thinking">
                  <Sparkles size={14} className="thinking-sparkle" />
                  <span>CAMVIA AI is analyzing records…</span>
                </div>
              </div>
            )}
          </div>

          {/* Large Rounded Composer with Embedded Send Button */}
          <form
            className="ask-edu-composer"
            onSubmit={(event) => {
              event.preventDefault()
              submitPrompt(query)
            }}
          >
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask about attendance, fees, approvals, or student focus areas…"
              disabled={generating}
              aria-label="Ask CAMVIA query"
            />
            <button
              type="submit"
              className="primary-button ask-send-button"
              disabled={generating || !query.trim()}
              aria-label="Send query"
            >
              <span>{generating ? 'Thinking…' : 'Ask'}</span>
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

export default AskEduPage
