import { useEffect, useId, useState } from 'react'
import orbArtwork from '../../assets/camvia-buddy-face-base.png'

export type BuddyEmotion =
  | 'idle'
  | 'happy'
  | 'thinking'
  | 'listening'
  | 'speaking'
  | 'alert'
  | 'sleep'
  | 'error'
  | 'success'
  | 'wink'

type BuddyFaceProps = {
  emotion: BuddyEmotion
  size?: number
  className?: string
}

const EYE_LEFT = { x: 516, y: 562 }
const EYE_RIGHT = { x: 730, y: 562 }
const EYE_WIDTH = 80
const EYE_HEIGHT = 164
const FACE_VIEWBOX_SIZE = 960

export function BuddyFace({ emotion, size = 76, className = '' }: BuddyFaceProps) {
  const id = useId().replace(/:/g, '')
  const [blinking, setBlinking] = useState(false)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (emotion !== 'idle' || size < 40) return

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let blinkTimer = 0
    let blinkEndTimer = 0
    let secondBlinkTimer = 0
    let gazeTimer = 0
    let stopped = false

    const clearTimers = () => {
      window.clearTimeout(blinkTimer)
      window.clearTimeout(blinkEndTimer)
      window.clearTimeout(secondBlinkTimer)
      window.clearTimeout(gazeTimer)
    }

    const scheduleBlink = () => {
      if (stopped || motionPreference.matches) return
      blinkTimer = window.setTimeout(() => {
        setBlinking(true)
        blinkEndTimer = window.setTimeout(() => {
          setBlinking(false)
          if (Math.random() < 0.22) {
            secondBlinkTimer = window.setTimeout(() => {
              setBlinking(true)
              blinkEndTimer = window.setTimeout(() => {
                setBlinking(false)
                scheduleBlink()
              }, 260)
            }, 170)
          } else {
            scheduleBlink()
          }
        }, 260)
      }, 2000 + Math.random() * 4000)
    }

    const scheduleGaze = () => {
      if (stopped || motionPreference.matches) return
      gazeTimer = window.setTimeout(() => {
        setGaze(Math.random() < 0.18
          ? { x: 0, y: 0 }
          : { x: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2), y: (Math.random() - 0.5) * 2 })
        gazeTimer = window.setTimeout(() => {
          setGaze({ x: 0, y: 0 })
          scheduleGaze()
        }, 500 + Math.random() * 700)
      }, 1800 + Math.random() * 3800)
    }

    const handleMotionPreference = () => {
      clearTimers()
      if (motionPreference.matches) {
        setBlinking(false)
        setGaze({ x: 0, y: 0 })
      } else {
        scheduleBlink()
        scheduleGaze()
      }
    }

    handleMotionPreference()
    motionPreference.addEventListener('change', handleMotionPreference)
    return () => {
      stopped = true
      clearTimers()
      motionPreference.removeEventListener('change', handleMotionPreference)
    }
  }, [emotion, size])

  const gazeX = gaze.x * FACE_VIEWBOX_SIZE / size
  const gazeY = gaze.y * FACE_VIEWBOX_SIZE / size

  const renderCapsule = (eye: typeof EYE_LEFT, side: 'left' | 'right', yOffset = 0) => (
    <g
      key={side}
      className={`buddy-eye buddy-eye-${side}`}
      transform={`rotate(${side === 'left' ? -1.5 : 1.5}, ${eye.x}, ${eye.y + yOffset})`}
    >
      <rect
        x={eye.x - EYE_WIDTH / 2}
        y={eye.y - EYE_HEIGHT / 2 + yOffset}
        width={EYE_WIDTH}
        height={EYE_HEIGHT}
        rx={EYE_WIDTH / 2}
        fill="#FFFFFF"
        filter={`url(#${id}-eye-glow)`}
      />
    </g>
  )

  return (
    <svg
      className={`buddy-face buddy-emotion-${emotion} ${className}`.trim()}
      width={size}
      height={size}
      viewBox={`160 140 ${FACE_VIEWBOX_SIZE} ${FACE_VIEWBOX_SIZE}`}
      role="img"
      aria-label={`CAMVIA Buddy ${emotion} expression`}
    >
      <defs>
        <filter id={`${id}-eye-glow`} x="-100%" y="-60%" width="300%" height="220%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="17" result="blur" />
          <feFlood floodColor="#3B82F6" floodOpacity=".65" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="buddy-reaction-motion">
        <g className="buddy-orb-body">
          <image href={orbArtwork} width="1254" height="1254" />
          <g
            className={`buddy-gaze${blinking && emotion === 'idle' ? ' is-blinking' : ''}`}
            transform={`translate(${emotion === 'idle' ? gazeX : 0} ${emotion === 'idle' ? gazeY : 0})`}
          >
            <g key={emotion} className="buddy-expression">
              {emotion === 'listening' ? (
                <g className="buddy-audio-bars" fill="#FFFFFF" filter={`url(#${id}-eye-glow)`}>
                  <rect x="580" y="500" width="48" height="126" rx="24" />
                  <rect x="650" y="454" width="48" height="218" rx="24" />
                  <rect x="720" y="500" width="48" height="126" rx="24" />
                </g>
              ) : emotion === 'speaking' ? (
                <>
                  {renderCapsule(EYE_LEFT, 'left')}
                  {renderCapsule(EYE_RIGHT, 'right')}
                  <g className="buddy-speech-bars" fill="#9CE8FF">
                    <rect x="578" y="705" width="32" height="60" rx="16" />
                    <rect x="625" y="680" width="32" height="110" rx="16" />
                    <rect x="672" y="690" width="32" height="90" rx="16" />
                    <rect x="719" y="714" width="32" height="46" rx="16" />
                  </g>
                </>
              ) : emotion === 'error' ? (
                <g fill="none" stroke="#FFFFFF" strokeWidth="26" strokeLinecap="round" filter={`url(#${id}-eye-glow)`}>
                  <path d="M478 524 L554 600 M554 524 L478 600 M692 524 L768 600 M768 524 L692 600" />
                </g>
              ) : emotion === 'happy' || emotion === 'success' ? (
                <g fill="none" stroke="#FFFFFF" strokeWidth="24" strokeLinecap="round" filter={`url(#${id}-eye-glow)`}>
                  <path d="M478 570 Q516 496 554 570" />
                  <path d="M692 570 Q730 496 768 570" />
                </g>
              ) : emotion === 'sleep' ? (
                <g fill="none" stroke="#FFFFFF" strokeWidth="20" strokeLinecap="round">
                  <path d="M480 557 Q516 581 552 557 M694 557 Q730 581 766 557" />
                </g>
              ) : emotion === 'wink' ? (
                <>
                  <g fill="none" stroke="#FFFFFF" strokeWidth="20" strokeLinecap="round">
                    <path d="M480 557 Q516 581 552 557" />
                  </g>
                  {renderCapsule(EYE_RIGHT, 'right')}
                </>
              ) : emotion === 'alert' ? (
                <>
                  <rect x="466" y="460" width="100" height="200" rx="48" fill="#FFFFFF" filter={`url(#${id}-eye-glow)`} />
                  <rect x="680" y="460" width="100" height="200" rx="48" fill="#FFFFFF" filter={`url(#${id}-eye-glow)`} />
                </>
              ) : (
                <>
                  {renderCapsule(EYE_LEFT, 'left', emotion === 'thinking' ? -20 : 0)}
                  {renderCapsule(EYE_RIGHT, 'right', emotion === 'thinking' ? -20 : 0)}
                </>
              )}
            </g>
          </g>
          {emotion === 'success' ? (
            <g className="buddy-sparkle" fill="#A78BFA">
              <path d="M840 330 L854 370 L894 384 L854 398 L840 438 L826 398 L786 384 L826 370 Z" />
              <circle cx="414" cy="386" r="15" />
            </g>
          ) : null}
          {emotion === 'thinking' ? <circle className="buddy-thought-dot" cx="866" cy="366" r="20" fill="#9CE8FF" /> : null}
        </g>
      </g>
    </svg>
  )
}
