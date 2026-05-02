import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { stripeService } from "../stripeService.js";

const router: IRouter = Router();

router.get("/me", (req, res) => {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims as any)?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    userId,
    isAdmin: stripeService.isAdmin(userId),
  });
});

export default router;
