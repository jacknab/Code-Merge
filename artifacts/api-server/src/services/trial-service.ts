import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";

export interface TrialStatus {
  isActive: boolean;
  daysRemaining: number | null;
  subscriptionStatus: string;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
}

export class TrialService {
  /**
   * Get the free trial days setting — reads TRIAL_PERIOD_DAYS env var,
   * falls back to 14 days if not set.
   */
  static async getFreeTrialDays(): Promise<number> {
    const envDays = parseInt(process.env.TRIAL_PERIOD_DAYS || '', 10);
    return isNaN(envDays) || envDays <= 0 ? 60 : envDays;
  }

  /**
   * Set up trial for a new user
   */
  static async setupTrialForUser(userId: string): Promise<void> {
    const freeTrialDays = await this.getFreeTrialDays();
    
    if (freeTrialDays <= 0) {
      // Trials are disabled, set to inactive
      await db.update(users)
        .set({ 
          subscriptionStatus: 'inactive',
          trialStartedAt: null,
          trialEndsAt: null
        })
        .where(eq(users.id, userId));
      return;
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + freeTrialDays * 24 * 60 * 60 * 1000);

    await db.update(users)
      .set({
        subscriptionStatus: 'trial',
        trialStartedAt: now,
        trialEndsAt: trialEndsAt
      })
      .where(eq(users.id, userId));
  }

  /**
   * Get trial status for a user
   */
  static async getTrialStatus(userId: string): Promise<TrialStatus> {
    const [user] = await db.select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new Error("User not found");
    }

    const now = new Date();
    let isActive = false;
    let daysRemaining: number | null = null;

    // Treat null/undefined as 'active' for backward compatibility with users
    // who existed before the trial system was introduced.
    const status = user.subscriptionStatus ?? 'active';

    if (status === 'active') {
      isActive = true;
    } else if (status === 'trial' && user.trialEndsAt) {
      if (now <= user.trialEndsAt) {
        isActive = true;
        const diffTime = user.trialEndsAt.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      } else {
        // Trial has expired, update status
        await db.update(users)
          .set({ subscriptionStatus: 'expired' })
          .where(eq(users.id, userId));
        
        user.subscriptionStatus = 'expired';
      }
    }

    return {
      isActive,
      daysRemaining,
      subscriptionStatus: status,
      trialStartedAt: user.trialStartedAt || null,
      trialEndsAt: user.trialEndsAt || null
    };
  }

  /**
   * Check if user can perform booking actions
   */
  static async canPerformBookingActions(userId: string): Promise<boolean> {
    const trialStatus = await this.getTrialStatus(userId);
    return trialStatus.isActive;
  }

  /**
   * Extend trial for a user (admin function)
   */
  static async extendTrial(userId: string, additionalDays: number): Promise<void> {
    const [user] = await db.select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new Error("User not found");
    }

    const newTrialEndsAt = new Date();
    if (user.trialEndsAt && user.trialEndsAt > newTrialEndsAt) {
      // Extend from existing end date
      newTrialEndsAt.setTime(user.trialEndsAt.getTime() + additionalDays * 24 * 60 * 60 * 1000);
    } else {
      // Start from now
      newTrialEndsAt.setTime(newTrialEndsAt.getTime() + additionalDays * 24 * 60 * 60 * 1000);
    }

    await db.update(users)
      .set({
        subscriptionStatus: 'trial',
        trialEndsAt: newTrialEndsAt,
        trialStartedAt: user.trialStartedAt || new Date()
      })
      .where(eq(users.id, userId));
  }

  /**
   * Reset trial for a user (admin function)
   */
  static async resetTrial(userId: string): Promise<void> {
    const freeTrialDays = await this.getFreeTrialDays();
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + freeTrialDays * 24 * 60 * 60 * 1000);

    await db.update(users)
      .set({
        subscriptionStatus: 'trial',
        trialStartedAt: now,
        trialEndsAt: trialEndsAt
      })
      .where(eq(users.id, userId));
  }

  /**
   * Convert trial to active subscription (admin function)
   */
  static async activateSubscription(userId: string): Promise<void> {
    await db.update(users)
      .set({
        subscriptionStatus: 'active',
        trialEndsAt: null
      })
      .where(eq(users.id, userId));
  }

  /**
   * Cancel subscription (admin function)
   */
  static async cancelSubscription(userId: string): Promise<void> {
    await db.update(users)
      .set({
        subscriptionStatus: 'cancelled'
      })
      .where(eq(users.id, userId));
  }
}
