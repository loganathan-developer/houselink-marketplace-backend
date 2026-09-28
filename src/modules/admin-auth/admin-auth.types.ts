import type { z } from "zod";
import type { loginSchema, challengeSchema, totpSchema, recoverySchema } from "./admin-auth.schema.js";

export type LoginBody = z.infer<typeof loginSchema>;
export type ChallengeBody = z.infer<typeof challengeSchema>;
export type TotpBody = z.infer<typeof totpSchema>;
export type RecoveryBody = z.infer<typeof recoverySchema>;
