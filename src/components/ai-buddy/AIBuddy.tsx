import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  EyeOff,
  Headphones,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { getCommunicationSummary } from '../../communicationData'
import { useAskCamviaChat } from './useAskCamviaChat'
import { BuddyFace, type BuddyEmotion } from './BuddyFace'
import { listenForBuddyEvents, type BuddyEventType } from './events'

type BuddyPreferences = {
  muted: boolean
  hidden: boolean
}

type SpeechAlternative = { transcript: string }
type SpeechResult = ArrayLike<SpeechAlternative> & { isFinal: boolean }
type SpeechResultList = ArrayLike<SpeechResult>
type SpeechRecognitionResultEvent = Event & { results: SpeechResultList }
type SpeechRecognitionErrorEvent = Event & { error: string }
type SpeechRecognitionInstance = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance
type VoiceWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

const STORAGE_KEY = 'camvia-buddy-preferences-v1'
const SUGGESTED_PROMPTS = [
  "Show today's attendance summary.",
  'How many students are enrolled?',
  'Show pending approvals.',
  'Help me register a student.',
  'Show fee collection summary.',
  'Draft a message to parents.',
]
const eventEmotions: Record<BuddyEventType, { emotion: BuddyEmotion; label: string; priority: number; duration: number }> = {
  'attendance-saved': { emotion: 'happy', label: 'Attendance saved successfully.', priority: 2, duration: 2000 },
  'student-created': { emotion: 'success', label: 'Student added successfully.', priority: 4, duration: 2500 },
  'fee-recorded': { emotion: 'happy', label: 'Payment recorded successfully.', priority: 2, duration: 2000 },
  'communication-sent': { emotion: 'success', label: 'Parent message sent successfully.', priority: 4, duration: 2500 },
  'approval-received': { emotion: 'alert', label: 'A new item is awaiting your review.', priority: 4, duration: 2000 },
  'operation-error': { emotion: 'error', label: 'That update needs attention. Please review the page for details.', priority: 5, duration: 2000 },
}
const DEBUG_EMOTIONS: BuddyEmotion[] = [
  'idle', 'happy', 'thinking', 'listening', 'speaking',
  'alert', 'error', 'success', 'sleep', 'wink',
]

function getPreferences(): BuddyPreferences {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return { muted: false, hidden: false }
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null) return { muted: false, hidden: false }
    const values = parsed as Record<string, unknown>
    return {
      muted: values.muted === true,
      hidden: values.hidden === true,
    }
  } catch (error) {
    console.warn('[CAMVIA Buddy] Could not restore display preferences:', error instanceof Error ? error.message : 'Storage unavailable')
    return { muted: false, hidden: false }
  }
}

export function AIBuddy() {
  const { user, students, communication, messages, query, setQuery, generating, submitPrompt, clearMessages } = useAskCamviaChat()
  const [preferences, setPreferences] = useState(getPreferences)
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [emotion, setEmotion] = useState<BuddyEmotion>('idle')
  const [debugEmotion, setDebugEmotion] = useState<BuddyEmotion | null>(null)
  const [notice, setNotice] = useState('')
  const [listening, setListening] = useState(false)
  const [speakingMessage, setSpeakingMessage] = useState<number | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const reactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reactionDeadlineRef = useRef<number | null>(null)
  const reactionRemainingRef = useRef(0)
  const debugTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityEmotionRef = useRef<BuddyEmotion | null>(null)
  const priorityRef = useRef(0)
  const previousApprovalsRef = useRef<number | null>(null)

  const summary = useMemo(
    () => user ? getCommunicationSummary(communication, students, user) : null,
    [communication, students, user],
  )
  const activityEmotion: BuddyEmotion | null = listening
    ? 'listening'
    : speakingMessage !== null
      ? 'speaking'
      : generating
        ? 'thinking'
        : null
  const displayEmotion = import.meta.env.DEV && debugEmotion
    ? debugEmotion
    : activityEmotion ?? emotion

  const persistPreferences = useCallback((next: BuddyPreferences) => {
    setPreferences(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      console.warn('[CAMVIA Buddy] Could not save display preferences:', error instanceof Error ? error.message : 'Storage unavailable')
    }
  }, [])

  const scheduleReactionEnd = useCallback(() => {
    if (activityEmotionRef.current || reactionRemainingRef.current <= 0) return
    reactionDeadlineRef.current = Date.now() + reactionRemainingRef.current
    reactionTimeoutRef.current = setTimeout(() => {
      reactionTimeoutRef.current = null
      reactionDeadlineRef.current = null
      if (activityEmotionRef.current) {
        reactionRemainingRef.current = Math.max(500, reactionRemainingRef.current)
        return
      }
      reactionRemainingRef.current = 0
      priorityRef.current = 0
      setEmotion('idle')
      setNotice('')
    }, reactionRemainingRef.current)
  }, [])

  const triggerReaction = useCallback((nextEmotion: BuddyEmotion, label: string, priority: number, duration: number) => {
    if (priority < priorityRef.current) return
    if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current)
    priorityRef.current = priority
    reactionRemainingRef.current = duration
    reactionDeadlineRef.current = null
    setEmotion(nextEmotion)
    setNotice(label)
    reactionTimeoutRef.current = null
    if (!activityEmotionRef.current) scheduleReactionEnd()
  }, [scheduleReactionEnd])

  const selectDebugEmotion = (nextEmotion: BuddyEmotion) => {
    if (debugTimeoutRef.current) clearTimeout(debugTimeoutRef.current)
    if (nextEmotion === 'idle') {
      setDebugEmotion(null)
      if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current)
      reactionTimeoutRef.current = null
      reactionDeadlineRef.current = null
      reactionRemainingRef.current = 0
      priorityRef.current = 0
      setEmotion('idle')
      setNotice('')
      return
    }

    setDebugEmotion(nextEmotion)
    const duration = nextEmotion === 'happy' || nextEmotion === 'alert' || nextEmotion === 'error'
      ? 2000
      : nextEmotion === 'success'
        ? 2500
        : nextEmotion === 'wink'
          ? 600
          : null
    if (duration !== null) {
      debugTimeoutRef.current = setTimeout(() => setDebugEmotion(null), duration)
    }
  }

  useEffect(() => {
    activityEmotionRef.current = activityEmotion
  }, [activityEmotion])

  useEffect(() => {
    if (activityEmotion) {
      if (reactionTimeoutRef.current && reactionDeadlineRef.current !== null) {
        clearTimeout(reactionTimeoutRef.current)
        reactionTimeoutRef.current = null
        reactionRemainingRef.current = Math.max(0, reactionDeadlineRef.current - Date.now())
        reactionDeadlineRef.current = null
      }
      return
    }

    if (emotion !== 'idle' && !reactionTimeoutRef.current) scheduleReactionEnd()
  }, [activityEmotion, emotion, scheduleReactionEnd])

  useEffect(() => listenForBuddyEvents((event) => {
    const reaction = eventEmotions[event.type]
    triggerReaction(reaction.emotion, reaction.label, reaction.priority, reaction.duration)
  }), [triggerReaction])

  useEffect(() => {
    if (summary === null) return
    if (previousApprovalsRef.current !== null && summary.awaitingApproval > previousApprovalsRef.current) {
      triggerReaction(
        'alert',
        `${summary.awaitingApproval} item${summary.awaitingApproval === 1 ? '' : 's'} awaiting approval.`,
        4,
        2000,
      )
    }
    previousApprovalsRef.current = summary.awaitingApproval
  }, [summary, triggerReaction])

  useEffect(() => {
    const node = messagesRef.current
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [messages, generating, open, minimized])

  useEffect(() => {
    if (!open || minimized) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [minimized, open])

  useEffect(() => () => {
    if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current)
    if (debugTimeoutRef.current) clearTimeout(debugTimeoutRef.current)
    recognitionRef.current?.abort()
    window.speechSynthesis?.cancel()
  }, [])

  const voiceConstructor = useMemo(() => {
    const voiceWindow = window as VoiceWindow
    return voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition ?? null
  }, [])

  const startVoiceInput = () => {
    if (!voiceConstructor) return
    const recognition = new voiceConstructor()
    recognition.lang = navigator.language || 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim()
      if (transcript) {
        setQuery(transcript)
        void submitPrompt(transcript)
      }
    }
    recognition.onerror = () => {
      setListening(false)
      triggerReaction('error', 'Voice input could not be completed. Try typing your question instead.', 5, 2000)
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch (error) {
      recognitionRef.current = null
      setListening(false)
      console.error('[CAMVIA Buddy] Voice input could not start:', error instanceof Error ? error.message : 'Unknown error')
      triggerReaction('error', 'Voice input could not start. Try typing your question instead.', 5, 2000)
    }
  }

  const stopVoiceInput = () => {
    recognitionRef.current?.stop()
    setListening(false)
  }

  const toggleSpeech = (text: string, index: number) => {
    if (!('speechSynthesis' in window)) return
    if (speakingMessage === index) {
      window.speechSynthesis.cancel()
      setSpeakingMessage(null)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onstart = () => {
      setSpeakingMessage(index)
    }
    utterance.onend = () => {
      setSpeakingMessage(null)
    }
    utterance.onerror = () => {
      setSpeakingMessage(null)
      triggerReaction('error', 'Voice playback could not be completed.', 5, 2000)
    }
    window.speechSynthesis.speak(utterance)
  }

  const toggleMute = () => {
    const muted = !preferences.muted
    if (muted) {
      window.speechSynthesis?.cancel()
      setSpeakingMessage(null)
    }
    persistPreferences({ ...preferences, muted })
  }

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitPrompt(query)
  }

  if (!user) return null

  if (preferences.hidden) {
    return (
      <div className="buddy-widget buddy-widget-hidden">
        <button type="button" className="buddy-restore-button" onClick={() => persistPreferences({ ...preferences, hidden: false })}>
          <BuddyFace emotion="idle" size={40} />
          <span>Show CAMVIA Buddy</span>
        </button>
      </div>
    )
  }

  return (
    <div className="buddy-widget" data-open={open}>
      {open ? (
        <section
          className={`buddy-panel ${minimized ? 'minimized' : ''}`}
          role="dialog"
          aria-label="CAMVIA Buddy assistant"
          aria-modal="false"
        >
          <header className="buddy-panel-header">
            <BuddyFace emotion={displayEmotion} size={42} />
            <div className="buddy-panel-title">
              <strong>CAMVIA Buddy</strong>
              <span>Powered by ELVAVEO AI</span>
            </div>
            <div className="buddy-panel-controls">
              <button
                type="button"
                aria-label={preferences.muted ? 'Unmute voice' : 'Mute voice'}
                title={preferences.muted ? 'Unmute voice' : 'Mute voice'}
                onClick={toggleMute}
              >
                {preferences.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <button type="button" aria-label={minimized ? 'Expand assistant' : 'Minimize assistant'} onClick={() => setMinimized(!minimized)}>
                {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
              </button>
              <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)}>
                <X size={17} />
              </button>
              <button
                type="button"
                aria-label="Hide CAMVIA Buddy"
                title="Hide Buddy"
                onClick={() => {
                  setOpen(false)
                  persistPreferences({ ...preferences, hidden: true })
                }}
              >
                <EyeOff size={16} />
              </button>
            </div>
          </header>

          {!minimized ? (
            <>
              {import.meta.env.DEV ? (
                <aside className="buddy-debug-panel" aria-label="CAMVIA Buddy reaction tests">
                  <span>Buddy reactions</span>
                  <div>
                    {DEBUG_EMOTIONS.map((debugEmotionName) => (
                      <button
                        key={debugEmotionName}
                        type="button"
                        aria-pressed={displayEmotion === debugEmotionName}
                        onClick={() => selectDebugEmotion(debugEmotionName)}
                      >
                        {debugEmotionName}
                      </button>
                    ))}
                  </div>
                </aside>
              ) : null}
              <div className="buddy-scope-note">
                School scope · {user.role === 'teacher' ? 'Assigned students and classes' : user.campusName}
              </div>
              <div className="buddy-suggestions" aria-label="Suggested questions">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button type="button" key={prompt} disabled={generating} onClick={() => void submitPrompt(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
              <div className="buddy-messages" ref={messagesRef} aria-live="polite">
                {messages.map((message, index) => (
                  <div className={`buddy-message ${message.role}`} key={`${message.role}-${index}`}>
                    {message.role === 'assistant' ? (
                      <div className="buddy-message-orb"><BuddyFace emotion="idle" size={26} /></div>
                    ) : null}
                    <div className={`buddy-message-bubble ${message.role}`}>
                      <p>{message.text}</p>
                      {message.role === 'assistant' && message.source === 'context' ? (
                        <small className="assistant-source-note">Contextual response · AI service unavailable</small>
                      ) : null}
                      {message.role === 'assistant' && 'speechSynthesis' in window ? (
                        <button
                          type="button"
                          className="buddy-speak-button"
                          disabled={preferences.muted}
                          aria-label={speakingMessage === index ? 'Stop speaking' : 'Read response aloud'}
                          onClick={() => toggleSpeech(message.text, index)}
                        >
                          {speakingMessage === index ? <Pause size={13} /> : <Headphones size={13} />}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {generating ? (
                  <div className="buddy-typing" role="status">
                    <BuddyFace emotion="thinking" size={26} />
                    <span><i /><i /><i /></span>
                    <span className="visually-hidden">CAMVIA Buddy is thinking</span>
                  </div>
                ) : null}
              </div>
              <div className="buddy-panel-footer">
                <button type="button" className="buddy-clear-button" onClick={clearMessages} disabled={generating}>
                  <RotateCcw size={13} /> Clear conversation
                </button>
                <form className="buddy-composer" onSubmit={(event) => void send(event)}>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Ask about your school…"
                    aria-label="Ask CAMVIA Buddy"
                    disabled={generating}
                  />
                  {voiceConstructor ? (
                    <button
                      type="button"
                      className={`buddy-voice-button ${listening ? 'listening' : ''}`}
                      aria-label={listening ? 'Stop voice input' : 'Start voice input'}
                      onClick={listening ? stopVoiceInput : startVoiceInput}
                    >
                      {listening ? <MicOff size={17} /> : <Mic size={17} />}
                    </button>
                  ) : null}
                  <button type="submit" className="buddy-send-button" disabled={generating || !query.trim()} aria-label="Send message">
                    {generating ? <span className="buddy-send-spinner" /> : <ArrowUp size={18} />}
                  </button>
                </form>
                <p className="buddy-disclaimer">Uses authorized CAMVIA records. Review critical details before acting.</p>
              </div>
            </>
          ) : (
            <button type="button" className="buddy-resume-button" onClick={() => setMinimized(false)}>
              <span>{notice || 'Assistant minimized'}</span><ChevronDown size={16} />
            </button>
          )}
        </section>
      ) : null}

      {!open ? (
        <div className="buddy-launcher-wrap">
          {notice ? <div className="buddy-status-note" role="status">{notice}<Check size={14} /></div> : null}
          <div className="buddy-tooltip">{notice || "Hi! I'm CAMVIA Buddy."}</div>
          <button
            type="button"
            className="buddy-launcher"
            aria-label="Open CAMVIA Buddy assistant"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <BuddyFace emotion={displayEmotion} size={76} />
            <span className="buddy-launcher-spark" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="buddy-launcher-mute"
            aria-label={preferences.muted ? 'Unmute voice' : 'Mute voice'}
            onClick={toggleMute}
          >
            {preferences.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>
      ) : null}
    </div>
  )
}
