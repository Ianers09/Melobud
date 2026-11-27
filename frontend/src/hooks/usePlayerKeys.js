import { useEffect } from 'react'

/** Keyboard shortcuts shared by the player and play-along practice. */
export function usePlayerKeys(player, { onPrevChord, onNextChord } = {}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        player.toggle()
      } else if (e.key === 'ArrowLeft') player.skip(-5)
      else if (e.key === 'ArrowRight') player.skip(5)
      else if (e.key === 'ArrowUp' && player.changeVolume) {
        e.preventDefault()
        player.changeVolume(0.05)
      } else if (e.key === 'ArrowDown' && player.changeVolume) {
        e.preventDefault()
        player.changeVolume(-0.05)
      } else if (e.key === 'm' || e.key === 'M') player.toggleMute?.()
      else if (e.key === '[') onPrevChord?.()
      else if (e.key === ']') onNextChord?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, onPrevChord, onNextChord])
}
