import { useContext } from 'react'
import { AskCamviaContext } from './context'

export function useAskCamviaChat() {
  const value = useContext(AskCamviaContext)
  if (!value) throw new Error('useAskCamviaChat must be used within AskCamviaProvider.')
  return value
}
