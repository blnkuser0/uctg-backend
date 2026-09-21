import rateLimit from "express-rate-limit";

const isTest = process.env.NODE_ENV === "test";

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { success: false, message: "Too many requests, please try again later." },
});

// Only FAILED attempts count. A whole team signing in for the first time from one office
// (one shared IP) must not lock each other out just by logging in successfully.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { success: false, message: "Too many auth attempts, please try again later." },
});

// Brute-force guard for the login form itself: failed attempts per IP *and* email, so one
// person mistyping doesn't block a colleague on the same network.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? "").trim().toLowerCase()}`,
  message: { success: false, message: "Too many failed sign-in attempts. Please wait a few minutes and try again." },
});

export const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { success: false, message: "Too many verification attempts, please try again later." },
});
