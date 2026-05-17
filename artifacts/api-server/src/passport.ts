import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { storage } from "./storage";

// ── Google LOGIN OAuth ──────────────────────────────────────────────────────
// This is ONLY for user authentication (login / signup).
// It uses GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET / GOOGLE_LOGIN_CALLBACK_URL.
// It NEVER touches Google Business APIs and NEVER uses business scopes.
// Falls back to legacy GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET for backward compatibility.

const loginClientId     = process.env.GOOGLE_LOGIN_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "";
const loginClientSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";

if (loginClientId && loginClientSecret) {
  // Replit dev domain takes priority so the callback lands back on the correct host.
  const callbackURL =
    process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/google/callback`
      : (process.env.GOOGLE_LOGIN_CALLBACK_URL ?? process.env.GOOGLE_AUTH_CALLBACK_URL ?? "https://certxa.com/api/auth/google/callback");

  console.log("[Google Login OAuth] Configuring passport strategy");
  console.log("[Google Login OAuth]   client_id   :", `${loginClientId.slice(0, 12)}…`);
  console.log("[Google Login OAuth]   callback_url:", callbackURL);
  console.log("[Google Login OAuth]   scopes      : openid, email, profile");

  passport.use(
    new GoogleStrategy(
      {
        clientID:     loginClientId,
        clientSecret: loginClientSecret,
        callbackURL,
        proxy:        true,  // trust X-Forwarded-* headers from Nginx
        state:        false, // disable session-based CSRF state — eliminates first-visit session timing failures
      },
      async (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
        try {
          const email    = profile.emails![0].value;
          const googleId = profile.id;

          console.log("[Google Login OAuth] Callback — profile returned for:", email);

          let user = await storage.findUserByGoogleId(googleId);

          if (!user) {
            user = await storage.findUserByEmail(email);
            if (user) {
              user = await storage.updateUser(user.id, { googleId });
              console.log("[Google Login OAuth] Linked Google ID to existing account:", email);
            } else {
              user = await storage.createUser({
                email,
                googleId,
                firstName:          profile.displayName.split(" ")[0],
                lastName:           profile.displayName.split(" ").slice(1).join(" "),
                password:           "",
                profileImageUrl:    profile.photos?.[0]?.value,
                onboardingCompleted: false,
              });
              console.log("[Google Login OAuth] Created new user:", email);
            }
          } else {
            console.log("[Google Login OAuth] Found existing user by Google ID:", email);
          }

          if (!user) throw new Error("Failed to create or retrieve user");

          console.log("[Google Login OAuth] Session will be created for user id:", user.id);
          return done(null, user);
        } catch (err) {
          console.error("[Google Login OAuth] Strategy error:", err);
          return done(err as any, null);
        }
      },
    ),
  );
} else {
  console.warn(
    "[Google Login OAuth] Not configured — missing GOOGLE_LOGIN_CLIENT_ID (or GOOGLE_CLIENT_ID) " +
    "and/or GOOGLE_LOGIN_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET). Google login will be unavailable."
  );
}

export default passport;
