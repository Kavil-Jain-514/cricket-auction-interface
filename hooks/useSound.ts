import { useCallback, useRef } from "react";

interface SoundEffects {
  bid: string;
  sold: string;
  unsold: string;
  timer: string;
  nextPlayer: string;
}

const SOUNDS: SoundEffects = {
  bid: "/sounds/bid.mp3",
  sold: "/sounds/sold.mp3",
  unsold: "/sounds/unsold.mp3",
  timer: "/sounds/timer.mp3",
  nextPlayer: "/sounds/next.mp3",
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
