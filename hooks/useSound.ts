import { useCallback, useRef } from "react";

interface SoundEffects {
  bid: string;
  sold: string;
  unsold: string;
  timer: string;
  nextPlayer: string;
}

const SOUNDS: SoundEffects = {
  bid: "/sounds/bid.wav",
  sold: "/sounds/sold.wav",
  unsold: "/sounds/unsold.wav",
  timer: "/sounds/timer.mp3",
  nextPlayer: "/sounds/next.wav",
};

export function useSound() {
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});

  const play = useCallback((sound: keyof SoundEffects, volume = 0.5) => {
    try {
      if (!audioRefs.current[sound]) {
        audioRefs.current[sound] = new Audio(SOUNDS[sound]);
      }

      const audio = audioRefs.current[sound];
      audio.volume = volume;
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Ignore autoplay policy errors
      });
    } catch (error) {
      console.warn("Failed to play sound:", error);
    }
  }, []);

  const stop = useCallback((sound: keyof SoundEffects) => {
    const audio = audioRefs.current[sound];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const setVolume = useCallback((sound: keyof SoundEffects, volume: number) => {
    const audio = audioRefs.current[sound];
    if (audio) {
      audio.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  return { play, stop, setVolume };
}
