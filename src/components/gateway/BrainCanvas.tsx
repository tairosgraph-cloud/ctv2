import { useEffect, useRef } from 'react'

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  size: number
}

const NODE_COUNT = 32
const RADIUS = 105
const LINK_DISTANCE = 75

/**
 * Red neuronal animada. Igual que en el prototipo, pero con el bucle atado al
 * ciclo de vida del componente (el original dejaba un requestAnimationFrame
 * corriendo para siempre) y con escalado por devicePixelRatio.
 */
export function BrainCanvas({ speaking }: { speaking: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const speakingRef = useRef(speaking)
  speakingRef.current = speaking

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const size = 320
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const center = size / 2
    const nodes: Node[] = Array.from({ length: NODE_COUNT }, () => {
      const angle = Math.random() * Math.PI * 2
      const radius = 35 + Math.random() * 60
      return {
        x: center + Math.cos(angle) * radius,
        y: center + Math.sin(angle) * radius,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        size: Math.random() * 3.5 + 2,
      }
    })

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const start = performance.now()

    const draw = (now: number) => {
      const elapsed = now - start
      const isSpeaking = speakingRef.current

      ctx.clearRect(0, 0, size, size)

      const pulse = reduceMotion
        ? 0
        : isSpeaking
          ? Math.sin(elapsed / 120) * 12
          : Math.sin(elapsed / 400) * 4

      const gradient = ctx.createRadialGradient(center, center, 10, center, center, 100 + pulse)
      gradient.addColorStop(0, 'rgba(45, 212, 191, 0.55)')
      gradient.addColorStop(0.5, 'rgba(13, 148, 136, 0.22)')
      gradient.addColorStop(1, 'rgba(2, 44, 40, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(center, center, 110 + pulse, 0, Math.PI * 2)
      ctx.fill()

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.hypot(dx, dy)
          if (dist < LINK_DISTANCE) {
            ctx.strokeStyle = `rgba(45, 212, 191, ${(1 - dist / LINK_DISTANCE) * 0.8})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
          }
        }
      }

      for (const node of nodes) {
        if (!reduceMotion) {
          const speed = isSpeaking ? 1.8 : 0.8
          node.x += node.vx * speed
          node.y += node.vy * speed

          // Rebote contra la esfera: reflejar sobre la normal en vez de
          // invertir ambas velocidades, que atrapaba nodos en el borde.
          const dx = node.x - center
          const dy = node.y - center
          const dist = Math.hypot(dx, dy)
          if (dist > RADIUS) {
            const nx = dx / dist
            const ny = dy / dist
            const dot = node.vx * nx + node.vy * ny
            node.vx -= 2 * dot * nx
            node.vy -= 2 * dot * ny
            node.x = center + nx * RADIUS
            node.y = center + ny * RADIUS
          }
        }

        ctx.fillStyle = isSpeaking ? '#99f6e4' : '#2dd4bf'
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2)
        ctx.fill()
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Red neuronal animada del asistente Tairos"
      className="relative z-10 h-full w-full"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
