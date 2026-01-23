import { Variants } from "framer-motion";

// Page transitions
export const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: "easeOut",
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: 0.3,
    },
  },
};

// Card animations
export const cardVariants: Variants = {
  initial: { scale: 0.9, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 25,
    },
  },
  hover: {
    scale: 1.02,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 10,
    },
  },
  tap: { scale: 0.98 },
};

// Player card entrance
export const playerCardVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.8,
    rotateY: -90,
  },
  visible: {
    opacity: 1,
    scale: 1,
    rotateY: 0,
    transition: {
      duration: 0.6,
      ease: [0.43, 0.13, 0.23, 0.96],
    },
  },
  exit: {
    opacity: 0,
    scale: 0.8,
    rotateY: 90,
    transition: {
      duration: 0.4,
    },
  },
};

// Bid notification
export const bidNotificationVariants: Variants = {
  initial: {
    x: 100,
    opacity: 0,
    scale: 0.8,
  },
  animate: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 500,
      damping: 30,
    },
  },
  exit: {
    x: -100,
    opacity: 0,
    scale: 0.8,
    transition: {
      duration: 0.2,
    },
  },
};

// Sold animation
export const soldAnimationVariants: Variants = {
  initial: {
    scale: 0,
    rotate: -180,
    opacity: 0,
  },
  animate: {
    scale: [0, 1.2, 1],
    rotate: 0,
    opacity: 1,
    transition: {
      duration: 0.8,
      times: [0, 0.6, 1],
      ease: "easeOut",
    },
  },
};

// Stagger container
export const staggerContainer: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

// List item
export const listItemVariants: Variants = {
  initial: {
    opacity: 0,
    x: -20,
  },
  animate: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 25,
    },
  },
};

// Timer pulse
export const timerPulseVariants: Variants = {
  normal: {
    scale: 1,
  },
  warning: {
    scale: [1, 1.1, 1],
    transition: {
      repeat: Infinity,
      duration: 1,
    },
  },
};

// Glow effect
export const glowVariants: Variants = {
  initial: {
    boxShadow: "0 0 0px rgba(59, 130, 246, 0)",
  },
  animate: {
    boxShadow: [
      "0 0 10px rgba(59, 130, 246, 0.5)",
      "0 0 30px rgba(59, 130, 246, 0.8)",
      "0 0 10px rgba(59, 130, 246, 0.5)",
    ],
    transition: {
      repeat: Infinity,
      duration: 2,
    },
  },
};
