import { ArrowRight, Bot, Sparkles } from 'lucide-react'
import { useAskCamviaChat } from './components/ai-buddy/useAskCamviaChat'

export function AskEduPage() {
  const { user, query, setQuery, generating, messages, submitPrompt } = useAskCamviaChat()
  if (!user) return null
  const suggestionCards = [
    'Summarize attendance risk for my classes',
    'Show me fee status and overdue totals',
    'What needs approval right now?',
    'Which students need attention today?',
  ]

  return (
    <section className="ask-edu-page">
      <div className="panel-header flex-header">
        <div>
          <p className="eyebrow">School Intelligence</p>
          <h1>Ask CAMVIA</h1>
        </div>
        <div className="status-pill updated-pill">Live school context</div>
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
                  {message.role === 'assistant' && message.source === 'context' && (
                    <small className="assistant-source-note">Contextual response · AI service unavailable</small>
                  )}
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
