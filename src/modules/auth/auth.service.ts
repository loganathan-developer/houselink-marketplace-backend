import type { RequestOtpBody, VerifyOtpBody } from "./auth.schema.js";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { createSession, type AuthTokens } from "./session.service.js";

import { HttpError } from "../../shared/errors/http-error.js";

import { otpProvider } from "./otp/otp-provider.factory.js";
import { getMockOtp } from "./otp/mock-otp.provider.js";

import {
  advisoryLockKey,
  generateOtp,
  hashOtp,
  verifyOtpDigest,
} from "./otp/otp.utils.js";

type RequestLoginOtpResult = {
  challengeId: string;
  expiresAt: Date;
  resendAvailableAt: Date;
};

type VerifiedUser = {
  id: string;
  phone?: string;
  email?: string;
  roles: string[];
};

type VerifyLoginOtpResult = {
  user: VerifiedUser;
  tokens: AuthTokens;
};

const invalidOtpError = () =>
  new HttpError(
    401,
    "INVALID_OTP",
    "Invalid or expired OTP.",
  );

export async function requestLoginOtp(
  input: RequestOtpBody,
): Promise<RequestLoginOtpResult> {
  const { channel } = input;
  const destination = "phone" in input ? input.phone : input.email;
  const lockKey = advisoryLockKey(`otp:${channel}:LOGIN:${destination}`);

  const otp = generateOtp();

  const challenge = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
    const now = new Date();

    const latestChallenge = await tx.otpChallenge.findFirst({
      where: {
        destination,
        channel,
        purpose: "LOGIN",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
      },
    });

    if (latestChallenge) {
      const cooldownEndsAt =
        latestChallenge.createdAt.getTime() +
        env.OTP_RESEND_COOLDOWN_SECONDS * 1000;

      if (Date.now() < cooldownEndsAt) {
        throw new HttpError(
          429,
          "OTP_RESEND_COOLDOWN",
          "Please wait before requesting another OTP.",
        );
      }
    }

    const aggregateWindowStart = new Date(
      now.getTime() -
        env.OTP_DESTINATION_WINDOW_SECONDS * 1000,
    );

    const destinationRequestCount =
      await tx.otpChallenge.count({
        where: {
          destination,
          channel,
          purpose: "LOGIN",
          createdAt: {
            gte: aggregateWindowStart,
          },
        },
      });

    if (
      destinationRequestCount >=
      env.OTP_DESTINATION_MAX_PER_WINDOW
    ) {
      throw new HttpError(
        429,
        "OTP_DESTINATION_RATE_LIMITED",
        "Too many OTP requests. Please try again later.",
      );
    }

    await tx.otpChallenge.updateMany({
      where: {
        destination,
        channel,
        purpose: "LOGIN",
        consumedAt: null,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: now,
      },
    });

    const expiresAt = new Date(
      now.getTime() +
        env.OTP_EXPIRES_IN_SECONDS * 1000,
    );

    const createdChallenge =
      await tx.otpChallenge.create({
        data: {
          destination,
          channel,
          purpose: "LOGIN",
          codeDigest: "pending",
          expiresAt,
          attemptCount: 0,
        },
      });

    const codeDigest = hashOtp({
      challengeId: createdChallenge.id,
      destination,
      channel,
      purpose: "LOGIN",
      otp,
    });

    return tx.otpChallenge.update({
      where: {
        id: createdChallenge.id,
      },
      data: {
        codeDigest,
      },
      select: {
        id: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  });

  try {
    await otpProvider.sendOtp(
      destination,
      otp,
      {
        channel,
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt,
      },
    );
  } catch (error) {
    await prisma.otpChallenge.update({
      where: {
        id: challenge.id,
      },

      data: {
        invalidatedAt: new Date(),
      },
    });

    throw new HttpError(
      503,
      "OTP_DELIVERY_FAILED",
      "Unable to send OTP. Please try again.",
    );
  }

  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    resendAvailableAt: new Date(challenge.createdAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000),
  };
}

export function getDevelopmentMockOtp(
  challengeId: string | undefined,
  ip: string | undefined,
) {
  if (
    env.NODE_ENV === "production" ||
    env.OTP_PROVIDER !== "mock" ||
    !env.ENABLE_MOCK_OTP_RETRIEVAL
  ) {
    throw new HttpError(
      404,
      "NOT_FOUND",
      "Route not found",
    );
  }

  if (
    !ip ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)
  ) {
    throw new HttpError(
      403,
      "LOCAL_ONLY",
      "Mock OTP retrieval is available only from localhost.",
    );
  }

  if (!challengeId) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "challengeId is required",
    );
  }

  const record = getMockOtp(challengeId);

  if (!record) {
    throw new HttpError(
      404,
      "MOCK_OTP_NOT_FOUND",
      "Mock OTP was not found or has expired.",
    );
  }

  return record;
}

export async function verifyLoginOtp(
  input: VerifyOtpBody,
): Promise<VerifyLoginOtpResult> {
  const { channel, challengeId, otp } = input;
  const destination = "phone" in input ? input.phone : input.email;
  const lockKey = advisoryLockKey(`otp:${channel}:LOGIN:${destination}`);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
    const now = new Date();

    const challenge = await tx.otpChallenge.findFirst({
      where: {
        id: challengeId,
        destination,
        channel,
        purpose: "LOGIN",
      },
      select: {
        id: true,
        destination: true,
        codeDigest: true,
        expiresAt: true,
        attemptCount: true,
        consumedAt: true,
        invalidatedAt: true,
      },
    });

    if (
      !challenge ||
      challenge.expiresAt <= now ||
      challenge.invalidatedAt !== null ||
      challenge.consumedAt !== null ||
      challenge.attemptCount >= env.OTP_MAX_ATTEMPTS
    ) {
      return { kind: "invalid" as const };
    }

    const candidateDigest = hashOtp({
      challengeId: challenge.id,
      destination,
      channel,
      purpose: "LOGIN",
      otp,
    });

    const isCorrectOtp = verifyOtpDigest(
      candidateDigest,
      challenge.codeDigest,
    );

    if (!isCorrectOtp) {
      const shouldInvalidate =
        challenge.attemptCount + 1 >=
        env.OTP_MAX_ATTEMPTS;

      await tx.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: {
            gt: now,
          },
          attemptCount: {
            lt: env.OTP_MAX_ATTEMPTS,
          },
        },
        data: {
          attemptCount: {
            increment: 1,
          },
          ...(shouldInvalidate
            ? { invalidatedAt: now }
            : {}),
        },
      });

      return { kind: "invalid" as const };
    }

    const identity =
      await tx.authIdentity.findUnique({
        where: {
          provider_identifier: {
            provider: channel,
            identifier: destination,
          },
        },
        include: {
          user: {
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          },
        },
      });

    if (identity && identity.user.status !== "ACTIVE") {
      return { kind: "blocked" as const };
    }

    let user: {
      id: string;
      status: string;
      roles: Array<{
        role: {
          code: string;
        };
      }>;
    };

    if (identity) {
      user = identity.user;
    } else {
      const buyerRole = await tx.role.findUnique({
        where: {
          code: "BUYER",
        },
        select: {
          id: true,
          code: true,
        },
      });

      if (!buyerRole) {
        return { kind: "missingBuyerRole" as const };
      }

      user = await tx.user.create({
        data: {
          identities: {
            create: {
              provider: channel,
              identifier: destination,
              verifiedAt: now,
            },
          },
          roles: {
            create: {
              roleId: buyerRole.id,
            },
          },
        },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });
    }

    const consumed =
      await tx.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          destination,
          channel,
          purpose: "LOGIN",
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: {
            gt: now,
          },
          attemptCount: {
            lt: env.OTP_MAX_ATTEMPTS,
          },
        },
        data: {
          consumedAt: now,
          userId: user.id,
        },
      });

    if (consumed.count !== 1) {
      throw invalidOtpError();
    }

    const tokens = await createSession(tx, user.id);
    return {
      kind: "success" as const,
      tokens,
      user: {
        id: user.id,
        ...(channel === "PHONE" ? { phone: destination } : { email: destination }),
        roles: user.roles.map((userRole) =>
          userRole.role.code
        ),
      },
    };
  });

  switch (result.kind) {
    case "success":
      return {
        user: result.user,
        tokens: result.tokens,
      };

    case "blocked":
      throw invalidOtpError();

    case "missingBuyerRole":
      throw new HttpError(
        500,
        "AUTH_CONFIGURATION_ERROR",
        "Authentication is not configured correctly.",
      );

    case "invalid":
      throw invalidOtpError();
  }
}
