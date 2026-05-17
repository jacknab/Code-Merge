import { Request, Response, NextFunction } from "express";
import { TrialService } from "../services/trial-service";

/**
 * Middleware to check trial status and restrict booking actions for expired trials
 */
export const requireActiveTrial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Check if user can perform booking actions
    const canBook = await TrialService.canPerformBookingActions(userId);
    
    if (!canBook) {
      return res.status(403).json({ 
        message: "Your free trial has ended. Upgrade your account to continue accepting bookings.",
        code: "TRIAL_EXPIRED"
      });
    }

    next();
  } catch (error) {
    console.error("Trial middleware error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Middleware to add trial status to request object
 */
export const addTrialStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req.session as any)?.userId;
    if (userId) {
      const trialStatus = await TrialService.getTrialStatus(userId);
      (req as any).trialStatus = trialStatus;
    }
    next();
  } catch (error) {
    console.error("Trial status middleware error:", error);
    next();
  }
};
