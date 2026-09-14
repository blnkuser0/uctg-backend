import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// A trailing slash here would make the CORS origin check and built attachment
// URLs mismatch what the browser actually sends/expects (e.g. "https://x.com/"
// vs "https://x.com") — trim it so a stray slash in a hosting provider's env
// var UI doesn't silently break auth.
const urlWithoutTrailingSlash = z.string().transform((val) => val.replace(/\/+$/, ""));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5001),
  CLIENT_URL: urlWithoutTrailingSlash.default("http://localhost:3000"),
  BACKEND_URL: urlWithoutTrailingSlash.default("http://localhost:5001"),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  UPLOAD_DIR: z.string().default("uploads"),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(25),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  server: {
    port: env.PORT,
    clientUrl: env.CLIENT_URL,
    backendUrl: env.BACKEND_URL,
  },
  mongo: {
    uri: env.MONGO_URI,
  },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },
  uploads: {
    dir: env.UPLOAD_DIR,
    maxSizeMb: env.MAX_UPLOAD_SIZE_MB,
  },
};

export type AppConfig = typeof config;
