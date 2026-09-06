import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api'
import useSpeechRecognition from './useSpeechRecognition'
import { speak, speechSynthesisSupported, stopSpeaking } from '../lib/voiceService'

// THE central voice pipeline for the whole tourist app. Every screen that
// offers voice goes through this hook, so microphone/TTS logic exists in
// exactly one place (this file plus its two primitives:
// ./useSpeechRecognition for STT and ../lib/voiceService for TTS) -- no
// page implements its own.
//
//   speech input -> speech-to-text (Web Speech API)
//                -> intent detection (backend services/copilot.py)
//                -> application action + text response
//                -> text-to-speech (SpeechSynthesis)
//
// Nothing here restricts what the tourist may say: whatever the recognizer
// returns is sent verbatim to the backend, which decides how to answer.
// There is no fixed client-side command list, and no phrase is special-
// cased in the UI.

// Errors that mean the microphone genuinely cannot be used, as opposed to
// "you didn't say anything" -- see the autoBlocked effect below.
const FATAL_MIC_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture'])

export default function useVoiceAssistant({
  endpoint, lang = 'en', speakByDefault = false, autoListen = false,
} = {}) {
  const [exchanges, setExchanges] = useState([]) // {question, answer}
  const [thinking, setThinking] = useState(false)
  const [speakReplies, setSpeakReplies] = useState(speakByDefault)
  const [autoBlocked, setAutoBlocked] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const speech = useSpeechRecognition({ lang: `${lang}-IN` })
  const lastHandledRef = useRef('')
  const startedRef = useRef(false)

  // Sending is deliberately independent of the microphone: a typed question
  // and a spoken one take the exact same path from here on.
  const ask = useCallback(async (question) => {
    const text = (question || '').trim()
    if (!text) return null
    setExchanges((e) => [...e, { question: text, answer: null }])
    setThinking(true)
    try {
      const { data } = await api.post(endpoint, { question: text })
      setExchanges((e) => e.map((x, i) => (i === e.length - 1 ? { ...x, answer: data.answer } : x)))
      if (speakReplies) {
        setSpeaking(true)
        speak(data.answer, lang).finally(() => setSpeaking(false))
      }
      return data.answer
    } catch {
      const failText = 'Sorry, I could not process that just now.'
      setExchanges((e) => e.map((x, i) => (i === e.length - 1 ? { ...x, answer: failText } : x)))
      if (speakReplies) {
        setSpeaking(true)
        speak(failText, lang).finally(() => setSpeaking(false))
      }
      return failText
    } finally {
      setThinking(false)
    }
  }, [endpoint, lang, speakReplies])

  // Push-to-talk. Speaking is stopped first so the assistant never talks
  // over the tourist (and never records its own voice).
  const toggleMic = useCallback(() => {
    if (speech.listening) {
      speech.stop()
      return
    }
    // A tap is a user gesture, so the browser can prompt for permission
    // again -- give hands-free another chance from here.
    setAutoBlocked(false)
    stopSpeaking()
    setSpeaking(false)
    speech.reset()
    lastHandledRef.current = ''
    speech.start()
  }, [speech])

  // Send automatically once recognition finishes -- no separate "send" tap
  // after speaking. Guarded so one transcript is only ever sent once.
  useEffect(() => {
    const text = (speech.transcript || '').trim()
    if (speech.listening || !text || thinking) return
    if (lastHandledRef.current === text) return
    lastHandledRef.current = text
    ask(text)
  }, [speech.listening, speech.transcript, thinking, ask])

  // Hands-free mode. The microphone opens on its own when the app loads and
  // reopens after each answer, so the tourist never has to tap anything.
  //
  // Two hard constraints shape this:
  //  * A browser refuses getUserMedia without a prior permission grant for
  //    the origin, so the very first visit still needs one tap. When that
  //    happens `autoBlocked` goes true and we STOP trying -- retrying in a
  //    loop would spam permission errors and drain the battery.
  //  * We never reopen the mic while the assistant is speaking, or it would
  //    transcribe its own voice back as the next question.
  const startListening = useCallback(() => {
    stopSpeaking()
    setSpeaking(false)
    speech.reset()
    lastHandledRef.current = ''
    speech.start()
  }, [speech])

  useEffect(() => {
    if (!autoListen || autoBlocked || startedRef.current) return
    if (!speech.supported) return
    startedRef.current = true
    startListening()
  }, [autoListen, autoBlocked, speech.supported, startListening])

  // Only a real permission/hardware refusal disables hands-free. "no-speech"
  // and "aborted" are the normal end of a listening window with nothing said
  // -- treating those as failures would switch the feature off the first
  // time the tourist simply stayed quiet.
  useEffect(() => {
    if (speech.error && FATAL_MIC_ERRORS.has(speech.error)) setAutoBlocked(true)
  }, [speech.error])

  // Reopen the mic once an answer is delivered (and finished being read
  // aloud, if the sound toggle is on).
  useEffect(() => {
    if (!autoListen || autoBlocked || thinking || speech.listening) return
    const last = exchanges[exchanges.length - 1]
    if (!last?.answer) return
    const delayMs = speakReplies ? 900 : 250
    const timer = setTimeout(() => {
      if (!speechSynthesisSupported() || !window.speechSynthesis.speaking) startListening()
    }, delayMs)
    return () => clearTimeout(timer)
  }, [autoListen, autoBlocked, thinking, speech.listening, exchanges, speakReplies, startListening])

  const toggleSpeakReplies = useCallback(() => {
    setSpeakReplies((v) => {
      if (v) {
        stopSpeaking()
        setSpeaking(false)
      }
      return !v
    })
  }, [])

  const clear = useCallback(() => {
    setExchanges([])
    speech.reset()
    lastHandledRef.current = ''
    stopSpeaking()
    setSpeaking(false)
  }, [speech])

  return {
    exchanges,
    thinking,
    ask,
    clear,
    // microphone
    micSupported: speech.supported,
    listening: speech.listening,
    transcript: speech.transcript,
    voiceError: speech.error,
    toggleMic,
    // hands-free
    autoBlocked,
    // speech output
    ttsSupported: speechSynthesisSupported(),
    speaking,
    lang,
    speakReplies,
    toggleSpeakReplies,
  }
}
