import { useCallback, useEffect, useRef, useState } from 'react'

// After a strum: skip the pick attack, then listen just long enough to
// recognise the chord (measured: 200 ms is 100% on test strums).
const SKIP_SECONDS = 0.04
const LISTEN_SECONDS = 0.22
// Strum triggers are relative to the room's own noise floor, so a quiet
// microphone works without turning the volume up. `min` only rejects near-silence.
// margin: dB above the noise floor; jump: sudden rise in dB between blocks.
const SENSITIVITY = {
  low: { min: -60, margin: 14, jump: 9 },
  normal: { min: -80, margin: 9, jump: 6 },
  high: { min: -95, margin: 6, jump: 4 },
}
// The input meter is shown relative to the noise floor (auto-boosted), 36 dB = full.
const METER_RANGE_DB = 36

/**
 * Microphone capture with strum detection.
 *
 * Audio is captured raw (no echo cancellation / noise suppression / AGC — those
 * processors are tuned for speech and distort a guitar's harmonics). A strum is
 * detected when the block level jumps well above the running noise floor
 * (not a fixed loudness, so quiet microphones work at any volume); the
 * next 220 ms (after skipping the pick attack) is handed to `onClip` as raw
 * samples, so it can be judged immediately in the browser.
 *
 * status: idle | requesting | listening | denied | unavailable | error
 */
export function useMicrophone({ onClip, enabled = true, sensitivity = 'normal' } = {}) {
  const [status, setStatus] = useState('idle')
  const [level, setLevel] = useState(0)
  const [errorMessage, setErrorMessage] = useState(null)
  const ctxRef = useRef(null)
  const streamRef = useRef(null)
  const nodeRef = useRef(null)
  const onClipRef = useRef(onClip)
  const enabledRef = useRef(enabled)
  const triggerRef = useRef(SENSITIVITY[sensitivity] ?? SENSITIVITY.normal)
  const state = useRef({ floor: -70, recording: null, recorded: 0, cooldownUntil: 0 })

  useEffect(() => {
    onClipRef.current = onClip
  }, [onClip])
  useEffect(() => {
    enabledRef.current = enabled
    triggerRef.current = SENSITIVITY[sensitivity] ?? SENSITIVITY.normal
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
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
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
      source.connect(node)
      // Keep the graph pulling without making the mic audible.
      const mute = ctx.createGain()
      mute.gain.value = 0
      node.connect(mute).connect(ctx.destination)
      const sr = ctx.sampleRate
      const skip = Math.round(SKIP_SECONDS * sr)
      const listen = Math.round(LISTEN_SECONDS * sr)
      let lastLevelUpdate = 0
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

        if (s.recording) {
          s.prevDb = db
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
            s.cooldownUntil = now + 80
            onClipRef.current?.(all.subarray(skip, skip + listen), sr, s.onsetAt)
          }
          return
        }

        // Track the noise floor slowly upward, quickly downward.
        s.floor = db < s.floor ? db * 0.3 + s.floor * 0.7 : db * 0.02 + s.floor * 0.98
        // A strum is a sudden jump in level; a ringing chord fading out never is.
        const jump = db - (s.prevDb ?? -90)
        s.prevDb = db
        const t = triggerRef.current
        const isOnset = db > t.min && db > s.floor + t.margin && jump >= t.jump
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
