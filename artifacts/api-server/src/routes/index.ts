import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import outrosRouter from "./outros";
import brandsRouter from "./brands";
import stripeRouter from "./stripe";
import webhookRouter from "./webhook";
import meRouter from "./me";
import storageRouter from "./storage";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims as any)?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const router: IRouter = Router();

router.use(healthRouter);
router.use(webhookRouter);  // webhook before requireAuth — verified by Stripe signature, not Clerk
router.use(stripeRouter);
router.use(requireAuth);
router.use(meRouter);
router.use(storageRouter);
router.use(jobsRouter);
router.use(outrosRouter);
router.use(brandsRouter);

export default router;
