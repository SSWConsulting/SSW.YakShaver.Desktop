import { useEffect, useState } from "react";

/** Burst of scissors confetti when an issue is created. CSS-only, no deps. */
export function ScissorsConfetti({ trigger }: { trigger: boolean }) {
  const [particles, setParticles] = useState<
    Array<{ id: number; x: number; y: number; rotate: number; scale: number; delay: number }>
  >([]);

  useEffect(() => {
    if (!trigger) return;
    const newParticles = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: -10,
      rotate: Math.random() * 720 - 360,
      scale: 0.5 + Math.random() * 0.8,
      delay: Math.random() * 0.3,
    }));
    setParticles(newParticles);
    const timeout = setTimeout(() => setParticles([]), 2000);
    return () => clearTimeout(timeout);
  }, [trigger]);

  if (particles.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute text-2xl"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform: `scale(${p.scale})`,
            animation: `confettiFall 1.5s ease-in ${p.delay}s forwards`,
          }}
        >
          &#9986;
        </div>
      ))}
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
