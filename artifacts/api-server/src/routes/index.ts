import path from "path";
import fs from "fs";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { jobsTable } from "@workspace/db/schema";
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

// Public thumbnail route — must be before requireAuth so <img> tags in blog/email
// HTML can load the image without Clerk session cookies.
router.get("/jobs/:id/thumbnail", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  try {
    const [job] = await db.select({ thumbnailPath: jobsTable.thumbnailPath })
      .from(jobsTable).where(eq(jobsTable.id, id));
    if (!job?.thumbnailPath) { res.status(404).json({ error: "Thumbnail not found" }); return; }
    // thumbnailPath may be absolute or object-storage key; serve if it's a local file
    const absPath = path.isAbsolute(job.thumbnailPath) ? job.thumbnailPath : path.resolve(job.thumbnailPath);
    if (!fs.existsSync(absPath)) { res.status(404).json({ error: "Thumbnail not found" }); return; }
    res.sendFile(absPath);
  } catch {
    res.status(500).json({ error: "Internal error" });
  }
});

router.use(requireAuth);
router.use(meRouter);
router.use(storageRouter);
router.use(jobsRouter);
router.use(outrosRouter);
router.use(brandsRouter);

export default router;
