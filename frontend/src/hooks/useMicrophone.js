import { useCallback, useEffect, useRef, useState } from 'react'
import { createOnsetDetector, ONSET_SENSITIVITY } from '../audio/onset'

// After a strum: skip the pick attack, then listen just long enough to
// recognise the chord (measured: 200 ms is 100% on test strums).
const SKIP_SECONDS = 0.04
const LISTEN_SECONDS = 0.22
// Strums are found by spectral flux (see audio/onset.js), so a new strum is
// detected even while the previous chord is still ringing.

// Digital boost for the analysis path only (the user never hears the mic).
// Light strums reach the detector at a healthy level; the audio graph is
// floating point, so nothing clips.
const ANALYSIS_BOOST_DB = 24
// The input meter is shown relative to the noise floor (auto-boosted), 36 dB = full.
const METER_RANGE_DB = 36

/**
 * Microphone capture with strum detection.
 *
 * Audio is captured raw (no noise suppression / AGC: those processors are tuned
 * for speech and distort a guitar's harmonics). Echo cancellation is enabled
 * only when the song plays at the same time (`echoCancellation`). A strum is
 * detected when new frequencies appear (spectral flux, relative to recent
 * playing, so soft strums over a ringing chord count too); the next 220 ms (after skipping the pick attack) is handed to `onClip` as raw
 * samples, so it can be judged immediately in the browser.
 *
 * status: idle | requesting | listening | denied | unavailable | error
 */
export function useMicrophone({ onClip, enabled = true, sensitivity = 'normal', echoCancellation = false } = {}) {
  const [status, setStatus] = useState('idle')
  const [level, setLevel] = useState(0)
  const [errorMessage, setErrorMessage] = useState(null)
  const ctxRef = useRef(null)
  const streamRef = useRef(null)
  const nodeRef = useRef(null)
  const onClipRef = useRef(onClip)
  const echoRef = useRef(echoCancellation)
  const enabledRef = useRef(enabled)
  const triggerRef = useRef(ONSET_SENSITIVITY[sensitivity] ?? ONSET_SENSITIVITY.normal)
  const state = useRef({ floor: -70, recording: null, recorded: 0, cooldownUntil: 0 })

  useEffect(() => {
    onClipRef.current = onClip
    echoRef.current = echoCancellation
  }, [onClip, echoCancellation])
  useEffect(() => {
    enabledRef.current = enabled
    triggerRef.current = ONSET_SENSITIVITY[sensitivity] ?? ONSET_SENSITIVITY.normal
  }, [enabled, sensitivity])

  const stop = useCallback(() => {
    nodeRef.current?.port && (nodeRef.current.port.onmessage = null)
    nodeRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current?.close().catch(() => {})
    nodeRef.current = null
    streamRef.current = null
    ctxRef.current = null
    setStatus((s) => (s === 'listening' || s === 'requesting' ? 'idle' : s))
    setLevel(0)
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
      setStatus('unavailable')
      setErrorMessage('This browser does not support microphone input. Please use a current version of Chrome, Edge, Firefox, or Safari.')
      return false
    }
    setStatus('requesting')
    setErrorMessage(null)
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation removes the song (played by this browser) from the
        // microphone, so the recording is never mistaken for the player's
        // strums. It is only used while the song plays (Play-along); otherwise
        // the raw signal is kept for the cleanest guitar tone.
        audio: { echoCancellation: echoRef.current, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setStatus('denied')
        setErrorMessage('Microphone access is blocked. Allow microphone access in your browser settings and try again.')
      } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
        setStatus('unavailable')
        setErrorMessage('No microphone was detected. Connect a microphone and try again.')
      } else if (err.name === 'NotReadableError') {
        setStatus('unavailable')
        setErrorMessage('Your microphone is in use by another application. Close it and try again.')
      } else {
        setStatus('error')
        setErrorMessage('The microphone could not be started. Please try again.')
      }
      return false
    }
    try {
      const ctx = new AudioContext()
      await ctx.audioWorklet.addModule('/capture-processor.js')
      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'capture-processor')
      // Analysis-only clean-up: cut rumble (fans, desk knocks, handling noise)
      // below the guitar's lowest string (E2, 82 Hz). The user never hears this
      // path, so their own volume and sound are unchanged.
      const lowCut = ctx.createBiquadFilter()
      lowCut.type = 'highpass'
      lowCut.frequency.value = 60
      lowCut.Q.value = 0.707
      const boost = ctx.createGain()
      boost.gain.value = 10 ** (ANALYSIS_BOOST_DB / 20)
      source.connect(lowCut).connect(boost).connect(node)
      // Keep the graph pulling without making the mic audible.
      const mute = ctx.createGain()
      mute.gain.value = 0
      node.connect(mute).connect(ctx.destination)
      const sr = ctx.sampleRate
      const skip = Math.round(SKIP_SECONDS * sr)
      const listen = Math.round(LISTEN_SECONDS * sr)
      let lastLevelUpdate = 0
      const detectOnset = createOnsetDetector(sr, () => triggerRef.current)
      const s = state.current
      s.floor = null // set from the first block heard
      s.recording = null

      node.port.onmessage = (event) => {
        const block = event.data
        let sum = 0
        for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
        const db = 10 * Math.log10(sum / block.length + 1e-12)
        if (s.floor == null) s.floor = db
        const now = performance.now()
        if (now - lastLevelUpdate > 60) {
          setLevel(Math.max(0, Math.min(1, (db - s.floor) / METER_RANGE_DB)))
          lastLevelUpdate = now
        }
        // The meter's reference: quiet room level (falls fast, rises slowly).
        s.floor = db < s.floor ? db * 0.3 + s.floor * 0.7 : db * 0.02 + s.floor * 0.98
        const isOnset = detectOnset(block, now)

        if (s.recording) {
          s.recording.push(block)
          s.recorded += block.length
          if (s.recorded >= skip + listen) {
            const all = new Float32Array(s.recorded)
            let o = 0
            for (const b of s.recording) {
              all.set(b, o)
              o += b.length
            }
            s.recording = null
            s.cooldownUntil = now
            onClipRef.current?.(all.subarray(skip, skip + listen), sr, s.onsetAt)
          }
          return
        }

        if (isOnset && enabledRef.current && now > s.cooldownUntil) {
          s.recording = [block]
          s.recorded = block.length
          s.onsetAt = now
        }
      }
      ctxRef.current = ctx
      streamRef.current = stream
      nodeRef.current = node
      setStatus('listening')
      return true
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      setStatus('error')
      setErrorMessage('Audio processing could not be started in this browser.')
      return false
    }
  }, [])

  useEffect(() => stop, [stop])

  return { status, level, errorMessage, start, stop }
}
